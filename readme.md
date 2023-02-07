# PDF Viewer

A basic PDF viewer built on PDFjs.

## Usage

This can be embedded as an iframe. Place the URL of the PDF in the query params like so:

```js
iframe.src = `https://morebetterlabs.github.io/pdfviewer?pdf=${encodeURIComponent(pdfURL)}`;
```

## Features

- Lazy loading of pages so large PDFs don't hose everything
- Basic navigation
- The usual Zoom / Scale features
- Full screen mode

## License

Licensed under [Apache](https://github.com/mozilla/pdf.js/blob/master/LICENSE).

