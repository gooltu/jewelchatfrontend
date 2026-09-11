/**
 * Generic XML child-lookup helpers shared across the chatserver/ stanza
 * parsers (stropheEvents.ts, messageArchive.ts, muclight.ts). Split into
 * their own module — rather than living on stropheEvents.ts, which several
 * of these consumers also need to import for other reasons — specifically
 * to avoid a circular import between stropheEvents.ts and muclight.ts.
 */

export function firstChildByTagName(elem: Element, tagName: string): Element | null {
  const nodes = elem.getElementsByTagName(tagName);
  return nodes.length > 0 ? nodes[0] : null;
}

export function firstChildByTagNameNs(elem: Element, tagName: string, ns: string): Element | null {
  const nodes = elem.getElementsByTagName(tagName);
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (node && node.getAttribute('xmlns') === ns) return node;
  }
  return null;
}
