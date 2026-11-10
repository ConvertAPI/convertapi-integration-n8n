import type { IBinaryData } from 'n8n-workflow';

const FORMAT_PATTERN = /^[a-z0-9]{1,20}$/;

/** MIME types n8n may report for a file without a usable extension. */
const MIME_TO_FORMAT: Record<string, string> = {
	'application/pdf': 'pdf',
	'application/msword': 'doc',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
	'application/vnd.ms-excel': 'xls',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
	'application/vnd.ms-powerpoint': 'ppt',
	'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
	'application/vnd.oasis.opendocument.text': 'odt',
	'application/vnd.oasis.opendocument.spreadsheet': 'ods',
	'application/vnd.oasis.opendocument.presentation': 'odp',
	'application/rtf': 'rtf',
	'text/rtf': 'rtf',
	'text/html': 'html',
	'text/plain': 'txt',
	'text/csv': 'csv',
	'text/markdown': 'md',
	'message/rfc822': 'eml',
	'application/vnd.ms-outlook': 'msg',
	'application/epub+zip': 'epub',
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/gif': 'gif',
	'image/tiff': 'tiff',
	'image/bmp': 'bmp',
	'image/webp': 'webp',
	'image/svg+xml': 'svg',
	'image/heic': 'heic',
};

/**
 * Formats whose ConvertAPI "to PDF" converter can write PDF/A itself (the `Pdfa` parameter).
 * Other formats are converted to PDF first and then to PDF/A in a second request.
 */
export const NATIVE_PDFA_FORMATS = new Set([
	'docx',
	'dotx',
	'eml',
	'jpg',
	'msg',
	'png',
	'ppsx',
	'pptx',
	'rtf',
	'tiff',
	'txt',
	'wpd',
	'xlsb',
	'xlsx',
]);

/** Turns '.DOCX', ' docx ' or 'DOCX' into 'docx'. */
export function normalizeFormat(value: unknown): string {
	return String(value ?? '')
		.trim()
		.toLowerCase()
		.replace(/^\.+/, '');
}

export function isValidFormat(format: string): boolean {
	return FORMAT_PATTERN.test(format);
}

/** The lowercase extension of a file name, or '' when it has none. */
export function extensionOf(fileName: string | undefined): string {
	const match = /\.([A-Za-z0-9]{1,20})$/.exec((fileName ?? '').trim());
	return match ? match[1].toLowerCase() : '';
}

/** Works out a binary file's format from its extension, its file name or its MIME type. */
export function detectFormat(binary: IBinaryData): string {
	const mimeType = (binary.mimeType ?? '').split(';')[0].trim().toLowerCase();
	return (
		normalizeFormat(binary.fileExtension) ||
		extensionOf(binary.fileName) ||
		MIME_TO_FORMAT[mimeType] ||
		''
	);
}

/** The file name to send to ConvertAPI, which names the output after it. */
export function inputFileName(binary: IBinaryData, format: string): string {
	const name = (binary.fileName ?? '').trim() || 'file';
	if (!format || extensionOf(name)) return name;
	return `${name}.${format}`;
}

/** Splits 'data, attachment_0' into ['data', 'attachment_0']. */
export function splitFieldNames(value: string): string[] {
	return value
		.split(',')
		.map((name) => name.trim())
		.filter((name) => name.length > 0);
}
