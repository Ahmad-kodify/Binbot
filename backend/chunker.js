// Chunker to split text into overlapping semantic blocks

function chunkText(text, options = {}) {
  const chunkSize = options.chunkSize || 600;
  const chunkOverlap = options.chunkOverlap || 120;

  if (!text || typeof text !== "string") return [];
  const clean = text.trim();
  if (clean.length <= chunkSize) {
    return [clean];
  }

  const chunks = [];
  let startIndex = 0;

  while (startIndex < clean.length) {
    let endIndex = startIndex + chunkSize;

    if (endIndex >= clean.length) {
      chunks.push(clean.slice(startIndex).trim());
      break;
    }

    // Attempt to break at a paragraph or sentence boundary near endIndex
    const lookback = clean.slice(startIndex + Math.floor(chunkSize * 0.7), endIndex);
    const splitMatch = lookback.match(/(?:\n\n|\.\s+|\?\s+|\!\s+)/g);

    if (splitMatch) {
      const lastMatch = splitMatch[splitMatch.length - 1];
      const matchIndex = lookback.lastIndexOf(lastMatch);
      endIndex = startIndex + Math.floor(chunkSize * 0.7) + matchIndex + lastMatch.length;
    }

    const chunk = clean.slice(startIndex, endIndex).trim();
    if (chunk.length > 20) {
      chunks.push(chunk);
    }

    // Move forward by chunkSize - overlap
    startIndex = Math.max(startIndex + 1, endIndex - chunkOverlap);
  }

  return chunks;
}

function processPagesIntoChunks(botId, pages) {
  const allChunks = [];
  let globalChunkIndex = 0;

  for (const page of pages) {
    const textChunks = chunkText(page.text);
    textChunks.forEach((chunkStr, i) => {
      allChunks.push({
        botId,
        url: page.url,
        title: page.title || "Untitled",
        chunkIndex: globalChunkIndex++,
        text: chunkStr,
        charCount: chunkStr.length,
      });
    });
  }

  return allChunks;
}

module.exports = {
  chunkText,
  processPagesIntoChunks,
};
