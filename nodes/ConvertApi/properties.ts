import type { INodeProperties, INodePropertyOptions } from 'n8n-workflow';

type Operation =
	| 'convert'
	| 'convertToPdf'
	| 'compress'
	| 'convertToExcel'
	| 'convertToWord'
	| 'merge'
	| 'ocr';

const OCR_LANGUAGES: INodePropertyOptions[] = [
	{ name: 'Arabic', value: 'ar' },
	{ name: 'Catalan', value: 'ca' },
	{ name: 'Chinese (Simplified)', value: 'zh-cn' },
	{ name: 'Chinese (Traditional)', value: 'zh-tw' },
	{ name: 'Danish', value: 'da' },
	{ name: 'Dutch', value: 'nl' },
	{ name: 'English', value: 'en' },
	{ name: 'Finnish', value: 'fi' },
	// ConvertAPI's code for French is "fa".
	{ name: 'French', value: 'fa' },
	{ name: 'German', value: 'de' },
	{ name: 'Greek', value: 'el' },
	{ name: 'Hebrew', value: 'he' },
	{ name: 'Italian', value: 'it' },
	{ name: 'Japanese', value: 'ja' },
	{ name: 'Korean', value: 'ko' },
	{ name: 'Lithuanian', value: 'lt' },
	{ name: 'Norwegian', value: 'no' },
	{ name: 'Polish', value: 'pl' },
	{ name: 'Portuguese', value: 'pt' },
	{ name: 'Romanian', value: 'ro' },
	{ name: 'Russian', value: 'ru' },
	{ name: 'Slovenian', value: 'sl' },
	{ name: 'Spanish', value: 'es' },
	{ name: 'Swedish', value: 'sv' },
	{ name: 'Thai', value: 'th' },
	{ name: 'Turkish', value: 'tr' },
	{ name: 'Ukrainian', value: 'ua' },
];

function show(resource: 'file' | 'pdf', operations: Operation[]) {
	return { show: { resource: [resource], operation: operations } };
}

const pageRange: INodeProperties = {
	displayName: 'Page Range',
	name: 'pageRange',
	type: 'string',
	default: '',
	placeholder: 'e.g. 1-3,5',
	description: 'The pages to process. Leave empty for all pages.',
};

const password: INodeProperties = {
	displayName: 'Password',
	name: 'password',
	type: 'string',
	typeOptions: { password: true },
	default: '',
	description: 'The password that opens a protected input file',
};

const inputFormat: INodeProperties = {
	displayName: 'Input Format',
	name: 'inputFormat',
	type: 'string',
	default: '',
	placeholder: 'e.g. docx',
	description:
		"The format of the input file. Leave empty to use the file's extension or MIME type.",
};

/** Options every operation has, listed after the operation's own options. */
const commonOptions: INodeProperties[] = [
	{
		displayName: 'Conversion Parameters',
		name: 'conversionParameters',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Parameter',
		default: {},
		description:
			'More ConvertAPI parameters for this conversion. Each converter lists its parameters at https://www.convertapi.com/api.',
		options: [
			{
				displayName: 'Parameter',
				name: 'parameter',
				values: [
					{
						displayName: 'Name',
						name: 'name',
						type: 'string',
						default: '',
						placeholder: 'e.g. PageSize',
					},
					{
						displayName: 'Value',
						name: 'value',
						type: 'string',
						default: '',
						placeholder: 'e.g. a4',
					},
				],
			},
		],
	},
	{
		displayName: 'Output File Name',
		name: 'outputFileName',
		type: 'string',
		default: '',
		placeholder: 'e.g. invoice',
		description:
			'The name of the output file, without the extension. Leave empty to use the input file name.',
	},
	{
		displayName: 'Put Output File in Field',
		name: 'binaryPropertyOutput',
		type: 'string',
		default: 'data',
		description: 'The name of the output binary field to put the file in',
	},
	{
		displayName: 'Timeout (Seconds)',
		name: 'timeout',
		type: 'number',
		typeOptions: { minValue: 10, maxValue: 1200 },
		default: 900,
		description: 'How long ConvertAPI may work on the file before it stops',
	},
];

function optionsCollection(
	resource: 'file' | 'pdf',
	operation: Operation,
	own: INodeProperties[],
): INodeProperties {
	return {
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: show(resource, [operation]),
		options: [...own, ...commonOptions],
	};
}

export const properties: INodeProperties[] = [
	{
		displayName: 'Resource',
		name: 'resource',
		type: 'options',
		noDataExpression: true,
		options: [
			{ name: 'File', value: 'file' },
			{ name: 'PDF', value: 'pdf' },
		],
		default: 'file',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['file'] } },
		options: [
			{
				name: 'Convert',
				value: 'convert',
				description: 'Convert a file to another format, for example DOCX to PDF or PDF to JPG',
				action: 'Convert file',
			},
			{
				name: 'Convert to PDF',
				value: 'convertToPdf',
				description: 'Turn a Word, Excel, PowerPoint, HTML, image or other file into a PDF',
				action: 'Convert file to PDF',
			},
		],
		default: 'convert',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['pdf'] } },
		options: [
			{
				name: 'Compress',
				value: 'compress',
				description: 'Make a PDF smaller by optimizing its images and fonts',
				action: 'Compress PDF',
			},
			{
				name: 'Convert to Excel',
				value: 'convertToExcel',
				description: 'Extract the tables in a PDF into an Excel workbook (XLSX)',
				action: 'Convert PDF to XLSX',
			},
			{
				name: 'Convert to Word',
				value: 'convertToWord',
				description: 'Turn a PDF into an editable Word document (DOCX)',
				action: 'Convert PDF to DOCX',
			},
			{
				name: 'Merge',
				value: 'merge',
				description: 'Combine several PDFs into one PDF',
				action: 'Merge PDF files',
			},
			{
				name: 'OCR',
				value: 'ocr',
				description: 'Make a scanned PDF searchable, or get its text as a TXT file',
				action: 'OCR PDF',
			},
		],
		default: 'convertToWord',
	},

	// Merge
	{
		displayName: 'Merge Mode',
		name: 'mergeMode',
		type: 'options',
		options: [
			{
				name: 'All Items Into One PDF',
				value: 'allItems',
				description: 'Merge the PDFs of every input item, in order, into a single PDF',
			},
			{
				name: 'Each Item Into Its Own PDF',
				value: 'eachItem',
				description: 'Merge the PDFs within each input item, giving one PDF per item',
			},
		],
		default: 'allItems',
		displayOptions: show('pdf', ['merge']),
	},
	{
		displayName: 'Input Binary Fields',
		name: 'binaryPropertyNames',
		type: 'string',
		default: 'data',
		required: true,
		placeholder: 'e.g. data, attachment_0',
		hint: 'The names of the input binary fields with the PDFs, separated by commas',
		description:
			'PDFs are merged in the order of the items and, within an item, in the order of these fields. Items without a listed field are skipped.',
		displayOptions: show('pdf', ['merge']),
	},

	// Every operation except Merge reads one file
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		required: true,
		placeholder: 'e.g. data',
		hint: 'The name of the input binary field containing the file to process',
		displayOptions: { hide: { operation: ['merge'] } },
	},

	// File > Convert
	{
		displayName: 'Output Format',
		name: 'outputFormat',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. pdf',
		description:
			'The format to convert to, as a file extension such as pdf, docx, xlsx, jpg, png or txt. See all supported conversions at https://www.convertapi.com/api.',
		displayOptions: show('file', ['convert']),
	},
	optionsCollection('file', 'convert', [inputFormat]),

	// File > Convert to PDF
	optionsCollection('file', 'convertToPdf', [
		inputFormat,
		pageRange,
		password,
		{
			displayName: 'PDF/A',
			name: 'pdfa',
			type: 'boolean',
			default: false,
			description:
				'Whether to create a PDF/A file for long-term archiving. Word, Excel and PowerPoint (OOXML), RTF, TXT, images and emails become PDF/A-3a directly; other formats take a second conversion to PDF/A-2b.',
		},
	]),

	// PDF > Compress
	{
		displayName: 'Preset',
		name: 'preset',
		type: 'options',
		options: [
			{
				name: 'Archive',
				value: 'archive',
				description: 'Strong compression for files you keep but rarely print',
			},
			{
				name: 'Ebook',
				value: 'ebook',
				description: 'Good image quality on screens and tablets',
			},
			{
				name: 'Lossless',
				value: 'lossless',
				description: 'A smaller file with no loss of image quality',
			},
			{
				name: 'Printer',
				value: 'printer',
				description: 'High image quality for printing',
			},
			{
				name: 'Text',
				value: 'text',
				description: 'The smallest file, for documents that are mostly text',
			},
			{
				name: 'Web',
				value: 'web',
				description: 'Balanced size and image quality for sharing online',
			},
		],
		default: 'web',
		description: 'How strongly to compress the PDF',
		displayOptions: show('pdf', ['compress']),
	},
	optionsCollection('pdf', 'compress', [password]),

	// PDF > Convert to Excel
	optionsCollection('pdf', 'convertToExcel', [
		pageRange,
		password,
		{
			displayName: 'Single Sheet',
			name: 'singleSheet',
			type: 'boolean',
			default: false,
			description: 'Whether to put all tables on one worksheet instead of one sheet per page',
		},
	]),

	// PDF > Convert to Word
	optionsCollection('pdf', 'convertToWord', [pageRange, password]),

	// PDF > Merge
	optionsCollection('pdf', 'merge', [
		{
			displayName: 'Bookmarks',
			name: 'bookmarks',
			type: 'options',
			options: [
				{ name: 'None', value: 'disabled' },
				{ name: 'File Name', value: 'filename' },
				{ name: 'PDF Title', value: 'title' },
			],
			default: 'disabled',
			description: 'Whether to add a top-level bookmark for each merged file, and how to name it',
		},
		password,
	]),

	// PDF > OCR
	{
		displayName: 'Language',
		name: 'language',
		type: 'options',
		options: OCR_LANGUAGES,
		default: 'en',
		description: 'The language of the text in the document',
		displayOptions: show('pdf', ['ocr']),
	},
	{
		displayName: 'Output',
		name: 'outputType',
		type: 'options',
		options: [
			{
				name: 'Searchable PDF',
				value: 'pdf',
				description: 'The PDF with a text layer added',
			},
			{
				name: 'Text File',
				value: 'txt',
				description: 'The recognized text as a TXT file',
			},
		],
		default: 'pdf',
		displayOptions: show('pdf', ['ocr']),
	},
	optionsCollection('pdf', 'ocr', [
		pageRange,
		password,
		{
			displayName: 'Recognition Quality',
			name: 'quality',
			type: 'options',
			options: [
				{
					name: 'Fast',
					value: 'fast',
					description: 'Good for clean scans',
				},
				{
					name: 'Enhanced',
					value: 'enhanced',
					description: 'Better for poor scans, photos, small print and handwriting, but slower',
				},
			],
			default: 'fast',
		},
	]),
];
