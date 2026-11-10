'use strict';

// A small stand-in for n8n's IExecuteFunctions, enough to run the node's execute()
// outside n8n. Unit tests pass a fake `http`; live tests pass one that calls ConvertAPI.

const path = require('node:path');
const { NodeOperationError } = require('n8n-workflow');

const MIME_TYPES = {
	pdf: 'application/pdf',
	docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
	html: 'text/html',
	txt: 'text/plain',
	csv: 'text/csv',
	jpg: 'image/jpeg',
	png: 'image/png',
	zip: 'application/zip',
};

function extensionOf(fileName) {
	return path.extname(fileName || '').slice(1).toLowerCase();
}

/** An n8n item with one binary field. Pass `fileName: undefined` to leave the name out. */
function binaryItem(fileName, content, { field = 'data', mimeType, json = {} } = {}) {
	const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
	const binary = {
		data: data.toString('base64'),
		mimeType: mimeType || MIME_TYPES[extensionOf(fileName)] || 'application/octet-stream',
	};
	if (fileName) {
		binary.fileName = fileName;
		binary.fileExtension = extensionOf(fileName) || undefined;
	}
	return { json, binary: { [field]: binary } };
}

function addBinary(item, field, fileName, content) {
	const extra = binaryItem(fileName, content, { field });
	item.binary[field] = extra.binary[field];
	return item;
}

/**
 * @param {object} options
 * @param {object[]} options.items input items
 * @param {object} options.params node parameters (same for every item)
 * @param {object[]} [options.perItemParams] per-item overrides
 * @param {object} [options.credentials] the ConvertAPI credential
 * @param {(request: object, index: number) => Promise<object>|object} options.http
 * @param {boolean} [options.continueOnFail]
 */
function createContext({
	items,
	params,
	perItemParams = [],
	credentials = { apiToken: 'unit-test-token', region: 'global' },
	http,
	continueOnFail = false,
}) {
	const requests = [];
	const node = {
		id: 'test-node',
		name: 'ConvertAPI',
		type: '@convertapi/n8n-nodes-convertapi.convertApi',
		typeVersion: 1,
		position: [0, 0],
		parameters: params,
	};
	const context = {
		requests,
		getInputData: () => items,
		getNode: () => node,
		getNodeParameter(name, itemIndex, fallback) {
			const own = perItemParams[itemIndex] || {};
			const value = name in own ? own[name] : params[name];
			if (value === undefined) {
				if (arguments.length >= 3) return fallback;
				throw new Error(`Could not get parameter '${name}'`);
			}
			return value;
		},
		async getCredentials(type) {
			if (type !== 'convertApiApi') throw new Error(`Unexpected credential type ${type}`);
			return credentials;
		},
		continueOnFail: () => continueOnFail,
		helpers: {
			assertBinaryData(itemIndex, field) {
				const binary = items[itemIndex].binary && items[itemIndex].binary[field];
				if (!binary) {
					throw new NodeOperationError(node, `No binary data in field '${field}'`, { itemIndex });
				}
				return binary;
			},
			async getBinaryDataBuffer(itemIndex, field) {
				return Buffer.from(items[itemIndex].binary[field].data, 'base64');
			},
			async prepareBinaryData(buffer, fileName, mimeType) {
				const extension = extensionOf(fileName);
				return {
					data: buffer.toString('base64'),
					mimeType: mimeType || MIME_TYPES[extension] || 'application/octet-stream',
					fileName,
					fileExtension: extension,
					fileSize: `${buffer.length} B`,
				};
			},
			async httpRequestWithAuthentication(credentialType, options) {
				if (credentialType !== 'convertApiApi') {
					throw new Error(`Unexpected credential type ${credentialType}`);
				}
				requests.push(options);
				return await http(options, requests.length - 1);
			},
		},
	};
	return context;
}

/** A ConvertAPI success response, as n8n returns it with returnFullResponse. */
function okResponse(files, conversionCost = 1) {
	return {
		statusCode: 200,
		headers: {},
		body: {
			ConversionCost: conversionCost,
			Files: files.map(([name, content]) => {
				const data = Buffer.from(content);
				return {
					FileName: name,
					FileExt: extensionOf(name),
					FileSize: data.length,
					FileData: data.toString('base64'),
				};
			}),
		},
	};
}

function errorResponse(statusCode, body) {
	return { statusCode, headers: {}, body };
}

/** The ConvertAPI parameters of a request as a plain { Name: value } object. */
function parametersOf(request) {
	const result = {};
	for (const parameter of request.body.Parameters) {
		if (parameter.FileValue) result[parameter.Name] = parameter.FileValue;
		else if (parameter.FileValues) result[parameter.Name] = parameter.FileValues;
		else result[parameter.Name] = parameter.Value;
	}
	return result;
}

module.exports = {
	addBinary,
	binaryItem,
	createContext,
	errorResponse,
	extensionOf,
	okResponse,
	parametersOf,
};
