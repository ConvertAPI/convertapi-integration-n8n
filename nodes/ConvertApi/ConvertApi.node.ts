import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPairedItemData,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	NATIVE_PDFA_FORMATS,
	detectFormat,
	inputFileName,
	isValidFormat,
	normalizeFormat,
	splitFieldNames,
} from './formats';
import { properties } from './properties';
import type { ConversionResult, InputFile } from './transport';
import { baseUrlForRegion, convert } from './transport';

/** Parameters the node sets itself, so 'Conversion Parameters' can't override them. */
const RESERVED_PARAMETERS = new Set(['file', 'files', 'storefile', 'secret', 'token', 'timeout']);

interface Job {
	source: string;
	target: string;
	files: InputFile[];
	parameters: IDataObject;
	/** Convert the result to PDF/A in a second request (for formats without native PDF/A). */
	pdfaFollowUp: boolean;
	action: string;
	options: IDataObject;
}

export class ConvertApi implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'ConvertAPI',
		name: 'convertApi',
		icon: { light: 'file:../../icons/convertapi.svg', dark: 'file:../../icons/convertapi.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description: 'Convert files between formats, and merge, compress or OCR PDFs with ConvertAPI',
		defaults: {
			name: 'ConvertAPI',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'convertApiApi',
				required: true,
			},
		],
		properties,
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;
		const credentials = await this.getCredentials('convertApiApi');
		const baseUrl = baseUrlForRegion(credentials.region);

		if (
			resource === 'pdf' &&
			operation === 'merge' &&
			this.getNodeParameter('mergeMode', 0) === 'allItems'
		) {
			const pairedItem: IPairedItemData[] = items.map((_, index) => ({ item: index }));
			try {
				const job = await mergeJob.call(this, items.map((_, index) => index));
				return [await runJob.call(this, baseUrl, job, pairedItem)];
			} catch (error) {
				if (this.continueOnFail()) {
					return [[{ json: { error: (error as Error).message }, pairedItem }]];
				}
				if (error instanceof NodeApiError) {
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject);
				}
				throw new NodeOperationError(this.getNode(), error as Error);
			}
		}

		const returnData: INodeExecutionData[] = [];
		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const job =
					resource === 'pdf' && operation === 'merge'
						? await mergeJob.call(this, [itemIndex])
						: await singleFileJob.call(this, resource, operation, itemIndex);
				returnData.push(...(await runJob.call(this, baseUrl, job, { item: itemIndex }, itemIndex)));
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				if (error instanceof NodeApiError) {
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject, { itemIndex });
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
			}
		}
		return [returnData];
	}
}

async function readFile(
	this: IExecuteFunctions,
	itemIndex: number,
	field: string,
	formatOverride: unknown,
): Promise<{ file: InputFile; format: string }> {
	const binary = this.helpers.assertBinaryData(itemIndex, field);
	const format = normalizeFormat(formatOverride) || detectFormat(binary);
	if (format && !isValidFormat(format)) {
		throw new NodeOperationError(this.getNode(), `'${format}' is not a file format`, {
			description: "Set 'Input Format' to a file extension such as docx, xlsx or html.",
			itemIndex,
		});
	}
	const data = await this.helpers.getBinaryDataBuffer(itemIndex, field);
	if (data.length === 0) {
		throw new NodeOperationError(this.getNode(), `The file in '${field}' is empty`, {
			description: 'Check the node that produced the file.',
			itemIndex,
		});
	}
	return { file: { name: inputFileName(binary, format), data }, format };
}

function assertPdf(
	this: IExecuteFunctions,
	format: string,
	field: string,
	itemIndex: number,
): void {
	if (format && format !== 'pdf') {
		throw new NodeOperationError(this.getNode(), `The file in '${field}' is not a PDF`, {
			description: `It looks like a ${format.toUpperCase()} file. Convert it with the File > Convert to PDF operation first, or pick the field that holds the PDF.`,
			itemIndex,
		});
	}
}

/** ConvertAPI parameters from the 'Conversion Parameters' option. */
function customParameters(
	this: IExecuteFunctions,
	options: IDataObject,
	itemIndex?: number,
): IDataObject {
	const collection = options.conversionParameters as
		| { parameter?: Array<{ name?: string; value?: string }> }
		| undefined;
	const parameters: IDataObject = {};
	for (const entry of collection?.parameter ?? []) {
		const name = String(entry.name ?? '').trim();
		if (!name) continue;
		if (RESERVED_PARAMETERS.has(name.toLowerCase()) || /^files\[/i.test(name)) {
			throw new NodeOperationError(
				this.getNode(),
				`'${name}' can't be set in 'Conversion Parameters'`,
				{
					description:
						"The node sets this parameter itself. Use 'Timeout (Seconds)' in the options to change the timeout.",
					itemIndex,
				},
			);
		}
		parameters[name] = entry.value ?? '';
	}
	return parameters;
}

/** Custom parameters first, so the node's own fields win. */
function withCommonParameters(
	this: IExecuteFunctions,
	options: IDataObject,
	own: IDataObject,
	itemIndex?: number,
): IDataObject {
	return {
		...customParameters.call(this, options, itemIndex),
		...own,
		FileName: options.outputFileName,
	};
}

async function singleFileJob(
	this: IExecuteFunctions,
	resource: string,
	operation: string,
	itemIndex: number,
): Promise<Job> {
	const field = this.getNodeParameter('binaryPropertyName', itemIndex) as string;
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
	const { file, format } = await readFile.call(this, itemIndex, field, options.inputFormat);
	const common = (own: IDataObject) =>
		withCommonParameters.call(this, options, own, itemIndex);
	const shared = { files: [file], pdfaFollowUp: false, options };

	if (resource === 'file' && operation === 'convert') {
		const target = normalizeFormat(this.getNodeParameter('outputFormat', itemIndex));
		if (!isValidFormat(target)) {
			throw new NodeOperationError(this.getNode(), "Set 'Output Format' to a file extension", {
				description: 'For example pdf, docx, xlsx, jpg, png or txt.',
				itemIndex,
			});
		}
		if (!format) {
			throw new NodeOperationError(this.getNode(), `Can't tell the format of the file in '${field}'`, {
				description: "Set 'Input Format' in the options, for example docx.",
				itemIndex,
			});
		}
		return {
			...shared,
			source: format,
			target,
			parameters: common({}),
			action: `convert ${format.toUpperCase()} to ${target.toUpperCase()}`,
		};
	}

	if (resource === 'file' && operation === 'convertToPdf') {
		const pdfa = options.pdfa === true;
		const own: IDataObject = { PageRange: options.pageRange, Password: options.password };
		if (format === 'pdf') {
			if (!pdfa) {
				throw new NodeOperationError(this.getNode(), `The file in '${field}' is already a PDF`, {
					description: "Turn on 'PDF/A' in the options to convert it to PDF/A.",
					itemIndex,
				});
			}
			return {
				...shared,
				source: 'pdf',
				target: 'pdfa',
				parameters: common({ Password: options.password }),
				action: 'convert PDF to PDF/A',
			};
		}
		// An unknown format goes to ConvertAPI's "any to PDF" converter.
		const source = format || 'any';
		const native = pdfa && NATIVE_PDFA_FORMATS.has(source);
		if (native) own.Pdfa = true;
		return {
			...shared,
			source,
			target: 'pdf',
			parameters: common(own),
			pdfaFollowUp: pdfa && !native,
			action: `convert ${source === 'any' ? 'the file' : source.toUpperCase()} to PDF`,
		};
	}

	assertPdf.call(this, format, field, itemIndex);
	const pdf = { ...shared, source: 'pdf' };

	switch (operation) {
		case 'convertToWord':
			return {
				...pdf,
				target: 'docx',
				parameters: common({ PageRange: options.pageRange, Password: options.password }),
				action: 'convert PDF to Word',
			};
		case 'convertToExcel':
			return {
				...pdf,
				target: 'xlsx',
				parameters: common({
					PageRange: options.pageRange,
					Password: options.password,
					SingleSheet: options.singleSheet,
				}),
				action: 'convert PDF to Excel',
			};
		case 'compress':
			return {
				...pdf,
				target: 'compress',
				parameters: common({
					Preset: this.getNodeParameter('preset', itemIndex),
					Password: options.password,
				}),
				action: 'compress the PDF',
			};
		case 'ocr':
			return {
				...pdf,
				target: 'ocr',
				parameters: common({
					OcrLanguage: this.getNodeParameter('language', itemIndex),
					OutputType: this.getNodeParameter('outputType', itemIndex),
					OcrQuality: options.quality,
					PageRange: options.pageRange,
					Password: options.password,
				}),
				action: 'run OCR on the PDF',
			};
		default:
			throw new NodeOperationError(
				this.getNode(),
				`The operation '${operation}' is not supported for '${resource}'`,
				{ itemIndex },
			);
	}
}

/** Collects the PDFs of the given items, in order, for one merge request. */
async function mergeJob(this: IExecuteFunctions, itemIndexes: number[]): Promise<Job> {
	const items = this.getInputData();
	const files: InputFile[] = [];
	const single = itemIndexes.length === 1 ? itemIndexes[0] : undefined;
	for (const itemIndex of itemIndexes) {
		const fields = splitFieldNames(this.getNodeParameter('binaryPropertyNames', itemIndex) as string);
		for (const field of fields) {
			if (!items[itemIndex].binary?.[field]) continue;
			const { file, format } = await readFile.call(this, itemIndex, field, '');
			assertPdf.call(this, format, field, itemIndex);
			files.push(file);
		}
	}
	if (files.length < 2) {
		throw new NodeOperationError(
			this.getNode(),
			`Found ${files.length === 0 ? 'no PDFs' : 'only one PDF'} to merge`,
			{
				description:
					"Merging needs at least two PDFs. Check 'Input Binary Fields' and 'Merge Mode'.",
				itemIndex: single,
			},
		);
	}
	const optionsIndex = single ?? 0;
	const options = this.getNodeParameter('options', optionsIndex, {}) as IDataObject;
	return {
		source: 'pdf',
		target: 'merge',
		files,
		parameters: withCommonParameters.call(
			this,
			options,
			{ BookmarksTableOfContents: options.bookmarks, Password: options.password },
			single,
		),
		pdfaFollowUp: false,
		action: `merge ${files.length} PDFs`,
		options,
	};
}

async function runJob(
	this: IExecuteFunctions,
	baseUrl: string,
	job: Job,
	pairedItem: IPairedItemData | IPairedItemData[],
	itemIndex?: number,
): Promise<INodeExecutionData[]> {
	const timeoutSeconds =
		typeof job.options.timeout === 'number' ? job.options.timeout : undefined;
	let result: ConversionResult = await convert.call(this, {
		baseUrl,
		source: job.source,
		target: job.target,
		files: job.files,
		parameters: job.parameters,
		timeoutSeconds,
		action: job.action,
		itemIndex,
	});

	if (job.pdfaFollowUp) {
		const firstCost = result.conversionCost ?? 0;
		result = await convert.call(this, {
			baseUrl,
			source: 'pdf',
			target: 'pdfa',
			files: result.files.map((file) => ({ name: file.fileName, data: file.data })),
			parameters: {},
			timeoutSeconds,
			action: 'convert the PDF to PDF/A',
			itemIndex,
		});
		result.conversionCost = firstCost + (result.conversionCost ?? 0);
	}

	const outputField = String(job.options.binaryPropertyOutput || 'data');
	const inputNames = job.files.map((file) => file.name);
	const count = result.files.length;
	const output: INodeExecutionData[] = [];
	for (const [index, file] of result.files.entries()) {
		const json: IDataObject = {
			fileName: file.fileName,
			fileExtension: file.fileExtension,
			fileSize: file.fileSize,
			conversionCost: result.conversionCost,
		};
		if (inputNames.length === 1) json.inputFileName = inputNames[0];
		else json.inputFileNames = inputNames;
		if (count > 1) {
			json.fileIndex = index;
			json.fileCount = count;
		}
		output.push({
			json,
			binary: {
				[outputField]: await this.helpers.prepareBinaryData(file.data, file.fileName),
			},
			pairedItem,
		});
	}
	return output;
}
