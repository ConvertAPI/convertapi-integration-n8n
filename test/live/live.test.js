'use strict';

// Live tests against the production ConvertAPI service. They run the node's execute()
// with a stand-in for n8n's request helper that adds the credential exactly as the
// credential's `authenticate` block describes it.
//
// Run with CONVERTAPI_TOKEN_FILE=/path/to/token-file (see scripts/test-live.sh). The token
// is read from the file and never printed. Each test costs about one conversion.
// Outputs are written to test-output/live/ for a manual look.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { before, describe, it } = require('node:test');
const { NodeApiError } = require('n8n-workflow');

const { ConvertApi } = require('../../dist/nodes/ConvertApi/ConvertApi.node.js');
const { ConvertApiApi } = require('../../dist/credentials/ConvertApiApi.credentials.js');
const { REGION_HOSTS } = require('../../dist/nodes/ConvertApi/transport.js');
const { binaryItem, createContext } = require('../helpers/context');

const TOKEN_FILE = process.env.CONVERTAPI_TOKEN_FILE;
const TOKEN = TOKEN_FILE && fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, 'utf8').trim() : '';
const skip = TOKEN ? false : 'CONVERTAPI_TOKEN_FILE is not set; live tests skipped';

const OUT = path.join(__dirname, '..', '..', 'test-output', 'live');
const CDN = 'https://cdn.convertapi.com/public/files';
const credential = new ConvertApiApi();
const node = new ConvertApi();
const fixtures = {};

const TABLE_HTML = `<html><body><h1>Quarterly sales</h1>
<table border="1"><tr><th>Region</th><th>Units</th><th>Revenue</th></tr>
<tr><td>North</td><td>120</td><td>3600</td></tr>
<tr><td>South</td><td>95</td><td>2850</td></tr>
<tr><td>West</td><td>143</td><td>4290</td></tr></table></body></html>`;
const SCAN_HTML = `<html><body style="font-family: Georgia, serif; font-size: 30px; margin: 60px">
<p>Invoice number 4471 was paid on November 10, 2026.</p>
<p>Thank you for choosing ConvertAPI for document automation.</p></body></html>`;

/** Applies the credential's `authenticate` headers, as n8n does. */
function authHeaders(token) {
	const headers = {};
	for (const [name, template] of Object.entries(credential.authenticate.properties.headers)) {
		headers[name] = template.replace(/^=/, '').replace('{{$credentials.apiToken}}', token);
	}
	return headers;
}

/** Evaluates the credential test's baseURL expression for a region. */
function credentialTestBaseUrl(region) {
	const expression = credential.test.request.baseURL.replace(/^=\{\{/, '').replace(/\}\}$/, '');
	return new Function('$credentials', `return (${expression});`)({ apiToken: 'x', region });
}

/** n8n's httpRequest, reduced to the options the node uses. */
function liveHttp(token) {
	return async (options) => {
		const response = await fetch(options.url, {
			method: options.method,
			headers: { ...options.headers, ...authHeaders(token), 'Content-Type': 'application/json' },
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
			signal: AbortSignal.timeout(options.timeout),
		});
		const text = await response.text();
		let body;
		try {
			body = JSON.parse(text);
		} catch {
			body = text;
		}
		if (!options.ignoreHttpStatusErrors && response.status >= 400) {
			throw new Error(`HTTP ${response.status}`);
		}
		return options.returnFullResponse
			? { body, headers: {}, statusCode: response.status, statusMessage: response.statusText }
			: body;
	};
}

async function run(items, params, { credentials, token = TOKEN } = {}) {
	const context = createContext({
		items,
		params,
		credentials: credentials || { apiToken: token, region: 'global' },
		http: liveHttp(token),
	});
	const [output] = await node.execute.call(context);
	return { output, requests: context.requests };
}

function fileOf(item, field = 'data') {
	return Buffer.from(item.binary[field].data, 'base64');
}

function save(name, item, field = 'data') {
	fs.writeFileSync(path.join(OUT, name), fileOf(item, field));
}

function assertPdf(buffer) {
	assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
}

function assertZipWith(buffer, entry) {
	assert.equal(buffer.subarray(0, 2).toString(), 'PK');
	assert.ok(buffer.includes(Buffer.from(entry)), `the file contains ${entry}`);
}

function pdfaPart(buffer) {
	const match = /pdfaid:part(?:>|="|\s*=\s*")(\d)/.exec(buffer.toString('latin1'));
	return match ? Number(match[1]) : undefined;
}

describe('live: ConvertAPI production', { skip }, () => {
	before(async () => {
		fs.mkdirSync(OUT, { recursive: true });
		for (const name of ['demo.docx', 'demo.pdf', 'demo2.pdf']) {
			const response = await fetch(`${CDN}/${name}`);
			assert.equal(response.status, 200, `download ${name}`);
			fixtures[name] = Buffer.from(await response.arrayBuffer());
		}
	});

	it('credential test: every region accepts the token, and a wrong token gets code 4011', async () => {
		for (const region of Object.keys(REGION_HOSTS)) {
			const baseUrl = credentialTestBaseUrl(region);
			assert.equal(baseUrl, `https://${REGION_HOSTS[region]}`);
			const good = await fetch(`${baseUrl}${credential.test.request.url}`, { headers: authHeaders(TOKEN) });
			const goodBody = await good.json();
			assert.notEqual(goodBody.Code, 4011, `${region}: the token is accepted`);
			assert.equal(goodBody.Code, 4000, `${region}: answers 'File is required'`);
		}
		const bad = await fetch(`https://v2.convertapi.com${credential.test.request.url}`, {
			headers: authHeaders('not-a-real-token'),
		});
		assert.equal(bad.status, 401);
		assert.equal((await bad.json()).Code, credential.test.rules[0].properties.value);
	});

	it('File > Convert: DOCX to PDF', async () => {
		const { output } = await run([binaryItem('demo.docx', fixtures['demo.docx'])], {
			resource: 'file',
			operation: 'convert',
			binaryPropertyName: 'data',
			outputFormat: 'pdf',
			options: {},
		});
		assert.equal(output.length, 1);
		assertPdf(fileOf(output[0]));
		assert.equal(output[0].json.fileName, 'demo.pdf');
		assert.ok(output[0].json.conversionCost >= 1);
		save('convert-docx-to-pdf.pdf', output[0]);
	});

	it('File > Convert to PDF: HTML table, then PDF > Convert to Excel and to Word', async () => {
		const { output } = await run([binaryItem('sales.html', TABLE_HTML)], {
			resource: 'file',
			operation: 'convertToPdf',
			binaryPropertyName: 'data',
			options: { outputFileName: 'sales-report' },
		});
		const pdf = fileOf(output[0]);
		assertPdf(pdf);
		assert.equal(output[0].json.fileName, 'sales-report.pdf');
		save('html-to-pdf.pdf', output[0]);

		const excel = await run([binaryItem('sales-report.pdf', pdf)], {
			resource: 'pdf',
			operation: 'convertToExcel',
			binaryPropertyName: 'data',
			options: { singleSheet: true },
		});
		assert.equal(excel.output[0].json.fileExtension, 'xlsx');
		assertZipWith(fileOf(excel.output[0]), 'xl/workbook.xml');
		save('pdf-to-excel.xlsx', excel.output[0]);

		const word = await run([binaryItem('demo.pdf', fixtures['demo.pdf'])], {
			resource: 'pdf',
			operation: 'convertToWord',
			binaryPropertyName: 'data',
			options: { pageRange: '1' },
		});
		assert.equal(word.output[0].json.fileExtension, 'docx');
		assertZipWith(fileOf(word.output[0]), 'word/document.xml');
		save('pdf-to-word.docx', word.output[0]);
	});

	it('File > Convert to PDF with PDF/A: DOCX in one step (PDF/A-3), HTML in two (PDF/A-2)', async () => {
		const params = {
			resource: 'file',
			operation: 'convertToPdf',
			binaryPropertyName: 'data',
			options: { pdfa: true },
		};
		const docx = await run([binaryItem('demo.docx', fixtures['demo.docx'])], params);
		assert.equal(docx.requests.length, 1);
		assert.equal(pdfaPart(fileOf(docx.output[0])), 3);
		save('docx-to-pdfa.pdf', docx.output[0]);

		const html = await run([binaryItem('sales.html', TABLE_HTML)], params);
		assert.equal(html.requests.length, 2);
		assert.equal(pdfaPart(fileOf(html.output[0])), 2);
		assert.ok(html.output[0].json.conversionCost >= 2, 'both conversions are counted');
		save('html-to-pdfa.pdf', html.output[0]);
	});

	it('PDF > Merge: all items into one, each item into its own, then one JPG per page', async () => {
		const all = await run(
			[binaryItem('demo.pdf', fixtures['demo.pdf']), binaryItem('demo2.pdf', fixtures['demo2.pdf'])],
			{
				resource: 'pdf',
				operation: 'merge',
				mergeMode: 'allItems',
				binaryPropertyNames: 'data',
				options: { bookmarks: 'filename', outputFileName: 'merged' },
			},
		);
		assert.equal(all.output.length, 1);
		const merged = fileOf(all.output[0]);
		assertPdf(merged);
		assert.equal(all.output[0].json.fileName, 'merged.pdf');
		assert.deepEqual(all.output[0].json.inputFileNames, ['demo.pdf', 'demo2.pdf']);
		assert.ok(merged.length > fixtures['demo2.pdf'].length);
		save('merge-all-items.pdf', all.output[0]);

		const item = binaryItem('demo.pdf', fixtures['demo.pdf']);
		item.binary.second = binaryItem('demo2.pdf', fixtures['demo2.pdf']).binary.data;
		const each = await run([item], {
			resource: 'pdf',
			operation: 'merge',
			mergeMode: 'eachItem',
			binaryPropertyNames: 'data, second',
			options: {},
		});
		assert.equal(each.output.length, 1);
		assertPdf(fileOf(each.output[0]));

		const pages = await run([binaryItem('merged.pdf', merged)], {
			resource: 'file',
			operation: 'convert',
			binaryPropertyName: 'data',
			outputFormat: 'jpg',
			options: {},
		});
		assert.ok(pages.output.length >= 2, `one JPG per page, got ${pages.output.length}`);
		assert.deepEqual(
			pages.output.map((o) => o.json.fileIndex),
			pages.output.map((_, index) => index),
		);
		for (const page of pages.output) {
			assert.deepEqual([...fileOf(page).subarray(0, 3)], [0xff, 0xd8, 0xff]);
		}
		save('merged-page-1.jpg', pages.output[0]);
	});

	it('PDF > Compress', async () => {
		const { output } = await run([binaryItem('demo.pdf', fixtures['demo.pdf'])], {
			resource: 'pdf',
			operation: 'compress',
			binaryPropertyName: 'data',
			preset: 'text',
			options: {},
		});
		const compressed = fileOf(output[0]);
		assertPdf(compressed);
		assert.ok(
			compressed.length < fixtures['demo.pdf'].length,
			`${compressed.length} < ${fixtures['demo.pdf'].length}`,
		);
		save('compress-text.pdf', output[0]);
	});

	it('PDF > OCR: text and searchable PDF from an image-only PDF', async () => {
		const image = await run([binaryItem('scan.html', SCAN_HTML)], {
			resource: 'file',
			operation: 'convert',
			binaryPropertyName: 'data',
			outputFormat: 'png',
			options: {},
		});
		const scan = await run([image.output[0]], {
			resource: 'file',
			operation: 'convertToPdf',
			binaryPropertyName: 'data',
			options: { outputFileName: 'scan' },
		});
		const scannedPdf = fileOf(scan.output[0]);
		assertPdf(scannedPdf);

		const text = await run([binaryItem('scan.pdf', scannedPdf)], {
			resource: 'pdf',
			operation: 'ocr',
			binaryPropertyName: 'data',
			language: 'en',
			outputType: 'txt',
			options: {},
		});
		const recognized = fileOf(text.output[0]).toString('utf8');
		assert.equal(text.output[0].json.fileExtension, 'txt');
		assert.match(recognized, /Invoice number 4471/);
		assert.match(recognized, /ConvertAPI/);
		save('ocr.txt', text.output[0]);

		const searchable = await run([binaryItem('scan.pdf', scannedPdf)], {
			resource: 'pdf',
			operation: 'ocr',
			binaryPropertyName: 'data',
			language: 'en',
			outputType: 'pdf',
			options: { quality: 'enhanced' },
		});
		assertPdf(fileOf(searchable.output[0]));
		save('ocr-searchable.pdf', searchable.output[0]);
	});

	it('uses the EU region', async () => {
		const { output, requests } = await run(
			[binaryItem('sales.html', TABLE_HTML)],
			{ resource: 'file', operation: 'convertToPdf', binaryPropertyName: 'data', options: {} },
			{ credentials: { apiToken: TOKEN, region: 'eu' } },
		);
		assert.ok(requests[0].url.startsWith('https://eu-v2.convertapi.com/'));
		assertPdf(fileOf(output[0]));
	});

	it('explains a wrong token, an unsupported conversion and a damaged file', async () => {
		const params = {
			resource: 'file',
			operation: 'convert',
			binaryPropertyName: 'data',
			outputFormat: 'pdf',
			options: {},
		};
		await assert.rejects(
			run([binaryItem('sales.html', TABLE_HTML)], params, { token: 'not-a-real-token' }),
			(error) =>
				error instanceof NodeApiError &&
				error.httpCode === '401' &&
				/did not accept the API token/.test(error.message),
		);
		await assert.rejects(
			run([binaryItem('demo.pdf', fixtures['demo.pdf'])], { ...params, outputFormat: 'foo' }),
			(error) => error instanceof NodeApiError && /cannot convert PDF to FOO/.test(error.message),
		);
		await assert.rejects(
			run([binaryItem('broken.pdf', '%PDF-1.4 this is not really a PDF')], {
				resource: 'pdf',
				operation: 'compress',
				binaryPropertyName: 'data',
				preset: 'web',
				options: {},
			}),
			(error) => {
				assert.ok(error instanceof NodeApiError);
				assert.match(error.message, /could not compress the PDF/);
				assert.ok(!JSON.stringify(error).includes(TOKEN), 'the token is not in the error');
				return true;
			},
		);
	});
});
