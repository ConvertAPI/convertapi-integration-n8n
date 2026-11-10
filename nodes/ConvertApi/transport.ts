import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	IN8nHttpFullResponse,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import { extensionOf } from './formats';

/** Kept in step with package.json by a unit test. */
export const PACKAGE_VERSION = '0.1.0';
export const USER_AGENT = `ConvertAPI-n8n/${PACKAGE_VERSION}`;

/** ConvertAPI's longest default conversion timeout, in seconds. */
const DEFAULT_TIMEOUT_SECONDS = 900;
/** Extra time for the upload and the download around the conversion itself. */
const HTTP_MARGIN_SECONDS = 60;

export const REGION_HOSTS: Record<string, string> = {
	global: 'v2.convertapi.com',
	eu: 'eu-v2.convertapi.com',
	uk: 'uk-v2.convertapi.com',
	us: 'us-v2.convertapi.com',
	ca: 'ca-v2.convertapi.com',
	as: 'as-v2.convertapi.com',
	au: 'au-v2.convertapi.com',
	jp: 'jp-v2.convertapi.com',
};

export function baseUrlForRegion(region: unknown): string {
	const host = REGION_HOSTS[String(region ?? '')] ?? REGION_HOSTS.global;
	return `https://${host}`;
}

export interface InputFile {
	name: string;
	data: Buffer;
}

export interface OutputFile {
	fileName: string;
	fileExtension: string;
	fileSize: number;
	data: Buffer;
}

export interface ConversionResult {
	files: OutputFile[];
	conversionCost?: number;
}

export interface ConversionRequest {
	baseUrl: string;
	source: string;
	target: string;
	files: InputFile[];
	/** ConvertAPI parameters; empty values are left out. */
	parameters: IDataObject;
	timeoutSeconds?: number;
	/** What the request does, for messages, for example "convert DOCX to PDF". */
	action: string;
	itemIndex?: number;
}

type ParameterValue = string | number | boolean;

interface ApiParameter {
	Name: string;
	Value?: ParameterValue;
	FileValue?: { Name: string; Data: string };
	FileValues?: Array<{ Name: string; Data: string }>;
}

/**
 * Sends the files to ConvertAPI in a JSON request (base64 file data) and returns the
 * converted files. StoreFile is always false, so ConvertAPI keeps no copy of the result.
 */
export async function convert(
	this: IExecuteFunctions,
	request: ConversionRequest,
): Promise<ConversionResult> {
	const { baseUrl, source, target, files, parameters, timeoutSeconds, action, itemIndex } = request;

	const apiParameters: ApiParameter[] = [];
	if (files.length === 1) {
		apiParameters.push({
			Name: 'File',
			FileValue: { Name: files[0].name, Data: files[0].data.toString('base64') },
		});
	} else {
		apiParameters.push({
			Name: 'Files',
			FileValues: files.map((file) => ({ Name: file.name, Data: file.data.toString('base64') })),
		});
	}
	for (const [name, value] of Object.entries(parameters)) {
		if (value === undefined || value === null || value === '') continue;
		apiParameters.push({ Name: name, Value: value as ParameterValue });
	}
	if (timeoutSeconds) {
		apiParameters.push({ Name: 'Timeout', Value: timeoutSeconds });
	}
	apiParameters.push({ Name: 'StoreFile', Value: false });

	const options: IHttpRequestOptions = {
		method: 'POST',
		url: `${baseUrl}/convert/${encodeURIComponent(source)}/to/${encodeURIComponent(target)}`,
		headers: {
			Accept: 'application/json',
			'User-Agent': USER_AGENT,
		},
		body: { Parameters: apiParameters } as unknown as IDataObject,
		json: true,
		timeout: ((timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) + HTTP_MARGIN_SECONDS) * 1000,
		ignoreHttpStatusErrors: true,
		returnFullResponse: true,
	};

	let response: IN8nHttpFullResponse;
	try {
		response = (await this.helpers.httpRequestWithAuthentication.call(
			this,
			'convertApiApi',
			options,
		)) as IN8nHttpFullResponse;
	} catch (error) {
		// Settings problems (for example a missing credential) keep their own message.
		if (error instanceof NodeOperationError) {
			throw new NodeOperationError(this.getNode(), error, { itemIndex });
		}
		const { message, code } = error as { message?: string; code?: string };
		const reason = [message, code ? `(${code})` : ''].filter(Boolean).join(' ') || 'No response';
		throw new NodeApiError(this.getNode(), { message: reason } as JsonObject, {
			message: `Could not reach ConvertAPI at ${baseUrl}`,
			description: `${reason.replace(/\.$/, '')}. Check the network connection of your n8n instance and try again. For large files, raise 'Timeout (Seconds)' in the options.`,
			itemIndex,
		});
	}

	const body = toObject(response.body);
	if (response.statusCode >= 400) {
		throw apiError.call(this, response.statusCode, body, request);
	}
	return parseResult.call(this, body, action, itemIndex);
}

function toObject(body: unknown): IDataObject {
	if (body && typeof body === 'object' && !Buffer.isBuffer(body)) return body as IDataObject;
	if (typeof body === 'string') {
		try {
			const parsed: unknown = JSON.parse(body);
			if (parsed && typeof parsed === 'object') return parsed as IDataObject;
		} catch {
			// Not JSON, for example an HTML page from a proxy: keep the text for the message.
		}
		return { Message: body.slice(0, 300) };
	}
	return {};
}

function parseResult(
	this: IExecuteFunctions,
	body: IDataObject,
	action: string,
	itemIndex?: number,
): ConversionResult {
	const rawFiles = Array.isArray(body.Files) ? (body.Files as IDataObject[]) : [];
	if (rawFiles.length === 0 || rawFiles.some((file) => !file.FileData)) {
		throw new NodeApiError(this.getNode(), body as JsonObject, {
			message: `ConvertAPI did not return a file when asked to ${action}`,
			description: 'Try again. If it happens again, send the file to support@convertapi.com.',
			itemIndex,
		});
	}
	const files = rawFiles.map((file, index): OutputFile => {
		const data = Buffer.from(String(file.FileData), 'base64');
		const fileName = String(file.FileName || `output-${index + 1}`);
		return {
			fileName,
			fileExtension: String(file.FileExt || extensionOf(fileName)).toLowerCase(),
			fileSize: Number(file.FileSize) || data.length,
			data,
		};
	});
	const cost = Number(body.ConversionCost);
	return { files, conversionCost: Number.isFinite(cost) ? cost : undefined };
}

function apiError(
	this: IExecuteFunctions,
	statusCode: number,
	body: IDataObject,
	request: ConversionRequest,
): NodeApiError {
	const apiMessage = typeof body.Message === 'string' ? body.Message.trim().replace(/\.$/, '') : '';
	const invalid =
		body.InvalidParameters && typeof body.InvalidParameters === 'object'
			? (body.InvalidParameters as IDataObject)
			: {};
	const details = Object.entries(invalid)
		.map(([name, problems]) => {
			const text = Array.isArray(problems) ? problems.join(' ') : String(problems);
			return `${name}: ${text.trim().replace(/\.$/, '')}`;
		})
		.join('; ');

	let message: string;
	let description: string;
	if (statusCode === 401) {
		message = 'ConvertAPI did not accept the API token';
		description =
			'Check the API token in the ConvertAPI credential. You can copy a token at https://www.convertapi.com/a/authentication.';
	} else if (/unsupported conversion/i.test(`${apiMessage} ${details}`) || statusCode === 404) {
		message = `ConvertAPI cannot convert ${request.source.toUpperCase()} to ${request.target.toUpperCase()}`;
		description =
			"Check the 'Output Format', and set 'Input Format' in the options if the file name has the wrong extension. See all supported conversions at https://www.convertapi.com/api.";
	} else if (statusCode === 402) {
		message = 'Your ConvertAPI account has no conversions left';
		description = 'Upgrade the plan at https://www.convertapi.com/pricing, then run the node again.';
	} else if (statusCode === 413) {
		message = 'The file is too large for ConvertAPI';
		description = 'Split the file into smaller parts, or compress it first.';
	} else if (statusCode === 429) {
		message = 'ConvertAPI got too many requests at once';
		description = 'Wait a moment and run the node again, or send fewer items at a time.';
	} else if (details) {
		message = `ConvertAPI did not accept the parameters to ${request.action}: ${details}`;
		description = "Check the node's options and 'Conversion Parameters'.";
	} else if (statusCode >= 500 && apiMessage) {
		message = `ConvertAPI could not ${request.action}: ${apiMessage}`;
		description =
			'Check that the file opens correctly and that the options, such as the page range, fit the file. If it keeps happening, send the file to support@convertapi.com.';
	} else if (statusCode >= 500) {
		message = `ConvertAPI could not ${request.action}`;
		description = 'ConvertAPI is busy or unavailable. Try again in a minute.';
	} else {
		message = `ConvertAPI could not ${request.action}${apiMessage ? `: ${apiMessage}` : ''}`;
		description = "Check the node's settings and try again.";
	}

	return new NodeApiError(this.getNode(), body as JsonObject, {
		message,
		description,
		httpCode: String(statusCode),
		itemIndex: request.itemIndex,
	});
}
