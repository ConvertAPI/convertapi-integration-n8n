# ConvertAPI node for n8n

The official [ConvertAPI](https://www.convertapi.com) node for [n8n](https://n8n.io). Convert files between formats in your workflows: Word, Excel, PowerPoint and HTML to PDF with layout as in Word, PDF to editable Word and Excel, and merge, compress and OCR PDFs.

**Package:** `@convertapi/n8n-nodes-convertapi` · **Author:** ConvertAPI (UAB ConvertAPI) · **Contact:** support@convertapi.com · **License:** MIT

n8n is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

- [Installation](#installation)
- [Credentials](#credentials)
- [Operations](#operations)
- [Usage](#usage)
- [Example workflow](#example-workflow)
- [Compatibility](#compatibility)
- [Privacy](#privacy)
- [Development](#development)
- [Version history](#version-history)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation. On self-hosted n8n, open **Settings > Community Nodes**, select **Install**, and enter `@convertapi/n8n-nodes-convertapi`.

n8n also lists a built-in **ConvertAPI** entry marked "HTTP request". That entry only adds your ConvertAPI token to the HTTP Request node, and you build each request yourself. This node has ready-made actions, works with binary files directly and lets you pick a processing region.

## Credentials

1. Sign up at https://www.convertapi.com/a/signup. Sign-up is free.
2. Copy an API token from https://www.convertapi.com/a/authentication.
3. In n8n, create a **ConvertAPI API** credential and paste the token.
4. Optionally pick a **Region** to keep your files in it: Asia, Australia, Canada, European Union, Japan, United Kingdom or United States. **Global** uses the nearest data center.

The credential test checks the token without using a conversion.

## Operations

| Resource | Operation | What it does |
| --- | --- | --- |
| File | **Convert** | Any format pair ConvertAPI supports, for example DOCX to PDF, PDF to JPG, HTML to DOCX, XLSX to CSV or PPTX to PNG. Set the output format as a file extension. |
| File | **Convert to PDF** | Word, Excel, PowerPoint, OpenDocument, RTF, TXT, HTML, images, emails and more to PDF. Optional page range, open password and PDF/A. |
| PDF | **Compress** | Make a PDF smaller with a preset: Lossless, Printer, Ebook, Web, Archive or Text. |
| PDF | **Convert to Excel** | Extract the tables of a PDF into an XLSX workbook, one sheet per page or all on one sheet. |
| PDF | **Convert to Word** | Turn a PDF into an editable DOCX. Scanned pages are recognized with OCR. |
| PDF | **Merge** | Combine the PDFs of all input items into one PDF, or the PDFs within each item, with optional bookmarks per file. |
| PDF | **OCR** | Make a scanned PDF searchable in 27 languages, or get its text as a TXT file. |

Every operation has **Conversion Parameters** for any other ConvertAPI parameter, for example `PageSize` = `a4` when converting HTML to PDF. Each converter lists its parameters at https://www.convertapi.com/api.

## Usage

**Input files.** The node reads a file from a binary field of each input item, `data` by default. Files usually come from the HTTP Request node (with **Response Format** set to **File**), Google Drive, Dropbox, an email trigger or a form upload. The node works out the format from the file extension, the file name or the MIME type; set **Input Format** in the options when a file has no extension.

**Output files.** Each converted file becomes an output item, with the file in the `data` binary field (change it with **Put Output File in Field**) and these JSON fields:

```json
{
	"fileName": "report.pdf",
	"fileExtension": "pdf",
	"fileSize": 225257,
	"conversionCost": 1,
	"inputFileName": "report.docx"
}
```

A conversion that returns several files, such as a PDF to JPG conversion with one image per page, returns one item per file, with `fileIndex` and `fileCount`. A merge lists its inputs in `inputFileNames`. **Output File Name** sets the name of the result without the extension.

**Merging.** With **Merge Mode** set to **All Items Into One PDF**, the node merges the PDFs of every input item, in order, into one PDF. With **Each Item Into Its Own PDF**, it merges the binary fields listed in **Input Binary Fields** within each item, for example `data, attachment_0`.

**PDF/A.** Word, Excel and PowerPoint (DOCX, XLSX, PPTX), RTF, TXT, images and emails are converted straight to PDF/A-3a. Other formats, such as HTML, DOC or ODT, are converted to PDF and then to PDF/A-2b in a second request, which counts as a second conversion. A PDF input is converted to PDF/A directly.

**Timeouts.** Large files and OCR can take several minutes. The node waits up to 16 minutes by default; set **Timeout (Seconds)** in the options to change how long ConvertAPI may work on a file.

**Errors.** When a conversion fails, the node stops with a message that says what happened and how to fix it, for example a wrong API token, no conversions left, an unsupported format pair or a wrong page range. Turn on **Continue On Fail** in the node settings to keep going and get the message in an `error` field instead. The API token never appears in messages.

## Example workflow

[examples/convertapi-example-workflow.json](examples/convertapi-example-workflow.json) downloads sample files, converts a DOCX to PDF/A, merges two PDFs, converts the merged PDF to Word and compresses it. Import it with **Import from File** in the workflow menu, then select your ConvertAPI credential in the ConvertAPI nodes.

## Compatibility

Tested with n8n 2.47.3 on November 10, 2026. The node uses n8n's community node API version 1.

## Privacy

Files are sent over HTTPS to ConvertAPI for conversion, to `v2.convertapi.com` or the regional host you pick. The node asks ConvertAPI to return results inline (`StoreFile=false`); in this mode ConvertAPI converts in memory and does not store input or output files. n8n stores workflow data according to your n8n settings. ConvertAPI's privacy policy, DPA and security documents are at https://www.convertapi.com/compliance.

## Development

```bash
npm install
npm run build
npm run lint
npm test
```

`npm test` runs the unit tests offline. The live tests call the production ConvertAPI service and use about 20 conversions:

```bash
CONVERTAPI_TOKEN_FILE=/path/to/token-file scripts/test-live.sh
```

The script reads the token from the file and masks it in the output. `npm run dev` starts a local n8n with the node loaded.

## Resources

- [ConvertAPI API reference](https://www.convertapi.com/api)
- [ConvertAPI documentation](https://docs.convertapi.com)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

## Support

Email support@convertapi.com or open an issue at https://github.com/ConvertAPI/convertapi-integration-n8n/issues.

## Version history

See [CHANGELOG.md](CHANGELOG.md).
