"use strict";

class LanguageAdapter {
  constructor({ id, extensions }) {
    if (!id || !Array.isArray(extensions) || !extensions.length) throw new Error("LanguageAdapter requires id and extensions.");
    this.id = id;
    this.extensions = new Set(extensions.map((extension) => extension.toLowerCase()));
  }

  supports(file) {
    const extension = file.slice(file.lastIndexOf(".")).toLowerCase();
    return this.extensions.has(extension);
  }

  scan() {
    throw new Error(`${this.id} adapter must implement scan().`);
  }
}

module.exports = { LanguageAdapter };
