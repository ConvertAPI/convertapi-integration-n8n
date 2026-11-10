'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { NodeApiError, NodeOperationError } = require('n8n-workflow');

const { ConvertApi } = require('../../dist/nodes/ConvertApi/ConvertApi.node.js');
const { ConvertApiApi } = require('../../dist/credentials/ConvertApiApi.credentials.js');
const transport = require('../../dist/nodes/ConvertApi/transport.js');
const formats = require('../../dist/nodes/ConvertApi/formats.js');
const pkg = require('../../package.json');
const {
	addBinary,
	binaryItem,
	createContext,
	errorResponse,
	okResponse,
	parametersOf,
} = require('../helpers/context');

const node = new ConvertApi();

async function run(options) {
	const context = createContext(options);
	const output = await node.execute.call(context);
	return { context, output: output[0], requests: context.requests };
}

const PDF = '%PDF-1.7 fake';

describe('package and description', () => {
	it('keeps the User-Agent version in step with package.json', () => {
		assert.equal(transport.PACKAGE_VERSION, pkg.version);
		assert.equal(transport.USER_AGENT, `ConvertAPI-n8n/${pkg.version}`);
	});

	it('registers the built node and credential in package.json', () => {
		assert.deepEqual(pkg.n8n.nodes, ['dist/nodes/ConvertApi/ConvertApi.node.js']);
		assert.deepEqual(pkg.n8n.credentials, ['dist/credentials/ConvertApiApi.credentials.js']);
		assert.deepEqual(pkg.dependencies, undefined, 'verified nodes may not have runtime dependencies');
		assert.equal(pkg.license, 'MIT');
	});

	it('describes the node', () => {
		const d = node.description;
		assert.equal(d.name, 'convertApi');
		assert.equal(d.displayName, 'ConvertAPI');
		assert.deepEqual(d.credentials, [{ name: 'convertApiApi', required: true }]);
		const operations = d.properties.filter((p) => p.name === 'operation');
		const values = operations.flatMap((p) => p.options.map((o) => o.value)).sort();
		assert.deepEqual(values, [
			'compress',
			'convert',
			'convertToExcel',
			'convertToPdf',
			'convertToWord',
			'merge',
			'ocr',
		]);
		for (const option of operations.flatMap((p) => p.options)) {
			assert.ok(option.action && option.description, `${option.value} needs an action and a description`);
		}
	});

	it('uses a credential name that does not clash with n8n\'s built-in "convertApi"', () => {
		const credential = new ConvertApiApi();
		assert.equal(credential.name, 'convertApiApi');
		assert.equal(credential.properties[0].typeOptions.password, true);
		assert.equal(
			credential.authenticate.properties.headers.Authorization,
			'=Bearer {{$credentials.apiToken}}',
		);
		const regions = credential.properties.find((p) => p.name === 'region').options.map((o) => o.value);
		assert.deepEqual(regions.sort(), Object.keys(transport.REGION_HOSTS).sort());
	});

	it('fails the credential test on the code ConvertAPI returns for a wrong token', () => {
		const { test } = new ConvertApiApi();
		assert.equal(test.request.url, '/convert/docx/to/pdf');
		assert.equal(test.request.ignoreHttpStatusErrors, true);
		assert.deepEqual(
			test.rules.map((rule) => [rule.type, rule.properties.key, rule.properties.value]),
			[['responseSuccessBody', 'Code', 4011]],
		);
	});
});

describe('formats', () => {
	it('detects the format from the extension, the name or the MIME type', () => {
		assert.equal(formats.detectFormat({ fileExtension: 'DOCX', mimeType: 'x' }), 'docx');
		assert.equal(formats.detectFormat({ fileName: 'a.b.Html', mimeType: 'x' }), 'html');
		assert.equal(
			formats.detectFormat({
				fileName: 'upload',
				mimeType:
					'application/vnd.openxmlformats-officedocument.wordprocessingml.document; charset=binary',
			}),
			'docx',
		);
		assert.equal(formats.detectFormat({ mimeType: 'application/octet-stream' }), '');
	});

	it('names input files so ConvertAPI can name the output', () => {
		assert.equal(formats.inputFileName({ fileName: 'report.docx' }, 'docx'), 'report.docx');
		assert.equal(formats.inputFileName({ fileName: 'report' }, 'docx'), 'report.docx');
		assert.equal(formats.inputFileName({}, 'pdf'), 'file.pdf');
		assert.equal(formats.inputFileName({}, ''), 'file');
	});

	it('maps regions to hosts', () => {
		assert.equal(transport.baseUrlForRegion('global'), 'https://v2.convertapi.com');
		assert.equal(transport.baseUrlForRegion('jp'), 'https://jp-v2.convertapi.com');
		assert.equal(transport.baseUrlForRegion(undefined), 'https://v2.convertapi.com');
		assert.equal(transport.baseUrlForRegion('nowhere'), 'https://v2.convertapi.com');
	});
});

describe('File > Convert', () => {
	const params = {
		resource: 'file',
		operation: 'convert',
		binaryPropertyName: 'data',
		outputFormat: 'PDF',
		options: {},
	};

	it('sends the file as JSON with StoreFile=false and returns the converted file', async () => {
		const { output, requests } = await run({
			items: [binaryItem('report.docx', 'DOCX bytes', { json: { id: 7 } })],
			params,
			http: () => okResponse([['report.pdf', PDF]], 2),
		});
		assert.equal(requests.length, 1);
		const request = requests[0];
		assert.equal(request.method, 'POST');
		assert.equal(request.url, 'https://v2.convertapi.com/convert/docx/to/pdf');
		assert.equal(request.json, true);
		assert.equal(request.returnFullResponse, true);
		assert.equal(request.ignoreHttpStatusErrors, true);
		assert.equal(request.timeout, 960000);
		assert.equal(request.headers['User-Agent'], transport.USER_AGENT);
		assert.equal(request.headers.Authorization, undefined, 'n8n adds the token, not the node');
		const sent = parametersOf(request);
		assert.deepEqual(sent.File, {
			Name: 'report.docx',
			Data: Buffer.from('DOCX bytes').toString('base64'),
		});
		assert.equal(sent.StoreFile, false);
		assert.equal('Timeout' in sent, false);

		assert.equal(output.length, 1);
		assert.deepEqual(output[0].json, {
			fileName: 'report.pdf',
			fileExtension: 'pdf',
			fileSize: PDF.length,
			conversionCost: 2,
			inputFileName: 'report.docx',
		});
		assert.equal(Buffer.from(output[0].binary.data.data, 'base64').toString(), PDF);
		assert.equal(output[0].binary.data.fileName, 'report.pdf');
		assert.deepEqual(output[0].pairedItem, { item: 0 });
	});

	it('uses the credential region', async () => {
		const { requests } = await run({
			items: [binaryItem('a.docx', 'x')],
			params,
			credentials: { apiToken: 't', region: 'eu' },
			http: () => okResponse([['a.pdf', PDF]]),
		});
		assert.equal(requests[0].url, 'https://eu-v2.convertapi.com/convert/docx/to/pdf');
	});

	it('works out the format from the MIME type, or takes it from the options', async () => {
		const mimeOnly = binaryItem(undefined, 'x', {
			mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		});
		const first = await run({
			items: [mimeOnly],
			params,
			http: () => okResponse([['file.pdf', PDF]]),
		});
		assert.equal(first.requests[0].url, 'https://v2.convertapi.com/convert/xlsx/to/pdf');
		assert.equal(parametersOf(first.requests[0]).File.Name, 'file.xlsx');

		const second = await run({
			items: [binaryItem('page.txt', '<p>x</p>')],
			params: { ...params, options: { inputFormat: '.HTML' } },
			http: () => okResponse([['page.pdf', PDF]]),
		});
		assert.equal(second.requests[0].url, 'https://v2.convertapi.com/convert/html/to/pdf');
	});

	it('asks for the input format when it cannot tell', async () => {
		await assert.rejects(
			run({
				items: [binaryItem(undefined, 'x', { mimeType: 'application/octet-stream' })],
				params,
				http: () => assert.fail('no request expected'),
			}),
			(error) =>
				error instanceof NodeOperationError &&
				/Can't tell the format/.test(error.message) &&
				/Input Format/.test(error.description),
		);
	});

	it('rejects an empty or invalid output format before calling ConvertAPI', async () => {
		for (const outputFormat of ['', 'p d f', '../pdf']) {
			await assert.rejects(
				run({
					items: [binaryItem('a.docx', 'x')],
					params: { ...params, outputFormat },
					http: () => assert.fail('no request expected'),
				}),
				/Output Format/,
			);
		}
	});

	it('returns one item per output file', async () => {
		const { output } = await run({
			items: [binaryItem('deck.pdf', PDF)],
			params: { ...params, outputFormat: 'jpg' },
			http: () =>
				okResponse([
					['deck-1.jpg', 'jpg1'],
					['deck-2.jpg', 'jpg2'],
				]),
		});
		assert.equal(output.length, 2);
		assert.deepEqual(
			output.map((item) => [item.json.fileName, item.json.fileIndex, item.json.fileCount]),
			[
				['deck-1.jpg', 0, 2],
				['deck-2.jpg', 1, 2],
			],
		);
		assert.deepEqual(output[1].pairedItem, { item: 0 });
	});

	it('passes conversion parameters, output name, output field and timeout', async () => {
		const { output, requests } = await run({
			items: [binaryItem('a.html', 'x')],
			params: {
				...params,
				options: {
					conversionParameters: {
						parameter: [
							{ name: 'PageSize', value: 'a4' },
							{ name: ' MarginTop ', value: '0' },
							{ name: '', value: 'ignored' },
						],
					},
					outputFileName: 'invoice',
					binaryPropertyOutput: 'pdf',
					timeout: 120,
				},
			},
			http: () => okResponse([['invoice.pdf', PDF]]),
		});
		const sent = parametersOf(requests[0]);
		assert.equal(sent.PageSize, 'a4');
		assert.equal(sent.MarginTop, '0');
		assert.equal(sent.FileName, 'invoice');
		assert.equal(sent.Timeout, 120);
		assert.equal(requests[0].timeout, 180000);
		assert.ok(output[0].binary.pdf);
		assert.equal(output[0].binary.data, undefined);
	});

	it('does not let conversion parameters replace what the node sets', async () => {
		for (const name of ['File', 'files', 'Files[0]', 'StoreFile', 'Timeout', 'Secret', 'Token']) {
			await assert.rejects(
				run({
					items: [binaryItem('a.docx', 'x')],
					params: {
						...params,
						options: { conversionParameters: { parameter: [{ name, value: 'x' }] } },
					},
					http: () => assert.fail('no request expected'),
				}),
				(error) => error instanceof NodeOperationError && error.message.includes(name.trim()),
			);
		}
	});

	it('fails clearly when the binary field is missing', async () => {
		await assert.rejects(
			run({
				items: [binaryItem('a.docx', 'x', { field: 'other' })],
				params,
				http: () => assert.fail('no request expected'),
			}),
			/data/,
		);
	});
});

describe('File > Convert to PDF', () => {
	const params = {
		resource: 'file',
		operation: 'convertToPdf',
		binaryPropertyName: 'data',
		options: {},
	};

	it('sends PageRange and Password only when set', async () => {
		const { requests } = await run({
			items: [binaryItem('a.docx', 'x'), binaryItem('b.docx', 'y')],
			params,
			perItemParams: [{}, { options: { pageRange: '1-2', password: 'secret' } }],
			http: () => okResponse([['a.pdf', PDF]]),
		});
		assert.deepEqual(Object.keys(parametersOf(requests[0])).sort(), ['File', 'StoreFile']);
		const second = parametersOf(requests[1]);
		assert.equal(second.PageRange, '1-2');
		assert.equal(second.Password, 'secret');
	});

	it('makes PDF/A in one step for formats that support it', async () => {
		const { requests, output } = await run({
			items: [binaryItem('a.docx', 'x')],
			params: { ...params, options: { pdfa: true } },
			http: () => okResponse([['a.pdf', PDF]]),
		});
		assert.equal(requests.length, 1);
		assert.equal(parametersOf(requests[0]).Pdfa, true);
		assert.equal(output[0].json.conversionCost, 1);
	});

	it('makes PDF/A in a second step for other formats, and adds up the cost', async () => {
		const { requests, output } = await run({
			items: [binaryItem('page.html', '<p>x</p>')],
			params: { ...params, options: { pdfa: true, outputFileName: 'archive' } },
			http: (request, index) =>
				index === 0 ? okResponse([['archive.pdf', PDF]], 1) : okResponse([['archive.pdf', 'PDF/A']], 2),
		});
		assert.deepEqual(
			requests.map((r) => r.url),
			[
				'https://v2.convertapi.com/convert/html/to/pdf',
				'https://v2.convertapi.com/convert/pdf/to/pdfa',
			],
		);
		assert.equal('Pdfa' in parametersOf(requests[0]), false);
		assert.deepEqual(parametersOf(requests[1]).File, {
			Name: 'archive.pdf',
			Data: Buffer.from(PDF).toString('base64'),
		});
		assert.equal(output[0].json.conversionCost, 3);
		assert.equal(Buffer.from(output[0].binary.data.data, 'base64').toString(), 'PDF/A');
	});

	it('turns a PDF into PDF/A, and refuses a PDF without PDF/A', async () => {
		const pdfa = await run({
			items: [binaryItem('a.pdf', PDF)],
			params: { ...params, options: { pdfa: true } },
			http: () => okResponse([['a.pdf', PDF]]),
		});
		assert.equal(pdfa.requests[0].url, 'https://v2.convertapi.com/convert/pdf/to/pdfa');

		await assert.rejects(
			run({ items: [binaryItem('a.pdf', PDF)], params, http: () => assert.fail('no request') }),
			/already a PDF/,
		);
	});

	it('sends files of unknown format to the "any to PDF" converter', async () => {
		const { requests } = await run({
			items: [binaryItem(undefined, 'x', { mimeType: 'application/octet-stream' })],
			params,
			http: () => okResponse([['file.pdf', PDF]]),
		});
		assert.equal(requests[0].url, 'https://v2.convertapi.com/convert/any/to/pdf');
		assert.equal(parametersOf(requests[0]).File.Name, 'file');
	});
});

describe('PDF operations', () => {
	const pdfItem = () => binaryItem('in.pdf', PDF);
	const cases = [
		[
			'convertToWord',
			{ options: { pageRange: '2', password: 'pw' } },
			'pdf/to/docx',
			{ PageRange: '2', Password: 'pw' },
		],
		[
			'convertToExcel',
			{ options: { singleSheet: true } },
			'pdf/to/xlsx',
			{ SingleSheet: true },
		],
		['compress', { preset: 'text', options: {} }, 'pdf/to/compress', { Preset: 'text' }],
		[
			'ocr',
			{ language: 'fa', outputType: 'txt', options: { quality: 'enhanced' } },
			'pdf/to/ocr',
			{ OcrLanguage: 'fa', OutputType: 'txt', OcrQuality: 'enhanced' },
		],
	];
	for (const [operation, extra, path, expected] of cases) {
		it(`${operation} calls ${path} with its parameters`, async () => {
			const { requests } = await run({
				items: [pdfItem()],
				params: { resource: 'pdf', operation, binaryPropertyName: 'data', ...extra },
				http: () => okResponse([['out.bin', 'x']]),
			});
			assert.equal(requests[0].url, `https://v2.convertapi.com/convert/${path}`);
			const sent = parametersOf(requests[0]);
			for (const [name, value] of Object.entries(expected)) assert.equal(sent[name], value, name);
		});
	}

	it('refuses a file that is clearly not a PDF', async () => {
		await assert.rejects(
			run({
				items: [binaryItem('letter.docx', 'x')],
				params: { resource: 'pdf', operation: 'compress', binaryPropertyName: 'data', preset: 'web', options: {} },
				http: () => assert.fail('no request expected'),
			}),
			(error) => /not a PDF/.test(error.message) && /DOCX/.test(error.description),
		);
	});
});

describe('PDF > Merge', () => {
	const params = {
		resource: 'pdf',
		operation: 'merge',
		mergeMode: 'allItems',
		binaryPropertyNames: 'data',
		options: { bookmarks: 'filename' },
	};

	it('merges the PDFs of all items into one, in order', async () => {
		const { requests, output } = await run({
			items: [
				binaryItem('a.pdf', 'A'),
				binaryItem('no-pdf.txt', 'x', { field: 'other' }),
				binaryItem('b.pdf', 'B'),
				binaryItem('c.pdf', 'C'),
			],
			params,
			http: () => okResponse([['a.pdf', PDF]]),
		});
		assert.equal(requests.length, 1);
		assert.equal(requests[0].url, 'https://v2.convertapi.com/convert/pdf/to/merge');
		const sent = parametersOf(requests[0]);
		assert.deepEqual(
			sent.Files.map((f) => f.Name),
			['a.pdf', 'b.pdf', 'c.pdf'],
		);
		assert.equal(sent.BookmarksTableOfContents, 'filename');
		assert.equal(output.length, 1);
		assert.deepEqual(output[0].json.inputFileNames, ['a.pdf', 'b.pdf', 'c.pdf']);
		assert.deepEqual(output[0].pairedItem, [{ item: 0 }, { item: 1 }, { item: 2 }, { item: 3 }]);
	});

	it('merges within each item', async () => {
		const items = [
			addBinary(binaryItem('a1.pdf', 'A1'), 'attachment_0', 'a2.pdf', 'A2'),
			addBinary(binaryItem('b1.pdf', 'B1'), 'attachment_0', 'b2.pdf', 'B2'),
		];
		const { requests, output } = await run({
			items,
			params: { ...params, mergeMode: 'eachItem', binaryPropertyNames: 'data, attachment_0' },
			http: () => okResponse([['merged.pdf', PDF]]),
		});
		assert.equal(requests.length, 2);
		assert.deepEqual(
			requests.map((r) => parametersOf(r).Files.map((f) => f.Name)),
			[
				['a1.pdf', 'a2.pdf'],
				['b1.pdf', 'b2.pdf'],
			],
		);
		assert.deepEqual(
			output.map((item) => item.pairedItem),
			[{ item: 0 }, { item: 1 }],
		);
	});

	it('needs at least two PDFs', async () => {
		await assert.rejects(
			run({ items: [binaryItem('a.pdf', 'A')], params, http: () => assert.fail('no request') }),
			/only one PDF/,
		);
	});
});

describe('errors', () => {
	const params = {
		resource: 'file',
		operation: 'convert',
		binaryPropertyName: 'data',
		outputFormat: 'pdf',
		options: {},
	};
	const cases = [
		[
			401,
			{ Code: 4011, Message: 'Unauthorized. Invalid or missing API credentials.' },
			/did not accept the API token/,
			/authentication/,
		],
		[
			400,
			{
				Code: 4000,
				Message: 'Parameter validation error.',
				InvalidParameters: { 'SourceFormat, DestinationFormat': ['Unsupported conversion docx -> pdf'] },
			},
			/cannot convert DOCX to PDF/,
			/convertapi\.com\/api/,
		],
		[
			400,
			{
				Code: 4000,
				Message: 'Parameter validation error.',
				InvalidParameters: { Preset: ['The submitted value bogus do not match any of these options.'] },
			},
			/did not accept the parameters to convert DOCX to PDF: Preset: The submitted value bogus/,
			/options/,
		],
		[500, { Code: 5002, Message: 'File is damaged.' }, /could not convert DOCX to PDF: File is damaged$/, /opens correctly/],
		[503, '<html>Service Unavailable</html>', /could not convert DOCX to PDF: <html>/, /opens correctly/],
		[429, {}, /too many requests/, /Wait a moment/],
	];
	for (const [status, body, message, description] of cases) {
		it(`explains HTTP ${status} ${JSON.stringify(body).slice(0, 40)}`, async () => {
			await assert.rejects(
				run({
					items: [binaryItem('a.docx', 'x')],
					params,
					http: () => errorResponse(status, body),
				}),
				(error) => {
					assert.ok(error instanceof NodeApiError, 'a NodeApiError');
					assert.match(error.message, message);
					assert.match(error.description, description);
					assert.equal(error.httpCode, String(status));
					assert.equal(error.context.itemIndex, 0);
					assert.ok(!JSON.stringify(error).includes('unit-test-token'));
					return true;
				},
			);
		});
	}

	it('explains network failures', async () => {
		await assert.rejects(
			run({
				items: [binaryItem('a.docx', 'x')],
				params,
				http: () => {
					throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
				},
			}),
			(error) =>
				error instanceof NodeApiError &&
				/Could not reach ConvertAPI at https:\/\/v2\.convertapi\.com/.test(error.message) &&
				/socket hang up \(ECONNRESET\)/.test(error.description),
		);
	});

	it('keeps going with "continue on fail" and pairs the error with its item', async () => {
		const { output } = await run({
			items: [binaryItem('bad.docx', 'x'), binaryItem('good.docx', 'y')],
			params,
			continueOnFail: true,
			http: (request) =>
				parametersOf(request).File.Name === 'bad.docx'
					? errorResponse(500, { Code: 5002, Message: 'File is damaged.' })
					: okResponse([['good.pdf', PDF]]),
		});
		assert.equal(output.length, 2);
		assert.match(output[0].json.error, /File is damaged/);
		assert.deepEqual(output[0].pairedItem, { item: 0 });
		assert.equal(output[1].json.fileName, 'good.pdf');
		assert.deepEqual(output[1].pairedItem, { item: 1 });
	});

	it('reports a response without files', async () => {
		await assert.rejects(
			run({
				items: [binaryItem('a.docx', 'x')],
				params,
				http: () => ({ statusCode: 200, headers: {}, body: { ConversionCost: 1, Files: [] } }),
			}),
			/did not return a file/,
		);
	});
});
