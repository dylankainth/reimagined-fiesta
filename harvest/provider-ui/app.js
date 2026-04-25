/** @typedef {import('pear-interface')} */ /* global Pear */

// This file initializes the Pear desktop app
// It handles communication between the backend (index.js) and the HTML window

Pear.updates(() => Pear.reload())

// The HTML will connect via Pear.pipe to receive state updates
