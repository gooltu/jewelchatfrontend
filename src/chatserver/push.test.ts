import { buildPushDisableIq, buildPushEnableIq, pushServiceJid } from './push';

jest.mock('./stropheClient', () => ({ getConnection: jest.fn(), isConnected: jest.fn() }));

// The real react-native-strophe (a sibling file: package) can't load under
// jest-expo's babel setup, so this is a minimal stand-in for Strophe's
// builder (c/t/up/tree), with its serialize output format (single-quoted
// attributes, self-closing empty elements).
jest.mock('react-native-strophe', () => {
  interface MockNode { name: string; attrs: Record<string, string>; children: (MockNode | string)[]; parent: MockNode | null }
  const make = (name: string, attrs: Record<string, string> = {}, parent: MockNode | null = null): MockNode => ({
    name, attrs, children: [], parent,
  });
  const builder = (root: MockNode) => {
    let cur = root;
    const api = {
      c(name: string, attrs?: Record<string, string>) {
        const n = make(name, attrs, cur);
        cur.children.push(n);
        cur = n;
        return api;
      },
      t(text: string) {
        cur.children.push(text);
        return api;
      },
      up() {
        cur = cur.parent ?? cur;
        return api;
      },
      tree: () => root,
    };
    return api;
  };
  const serialize = (n: MockNode | string): string => {
    if (typeof n === 'string') return n;
    const attrs = Object.entries(n.attrs).map(([k, v]) => ` ${k}='${v}'`).join('');
    return n.children.length
      ? `<${n.name}${attrs}>${n.children.map(serialize).join('')}</${n.name}>`
      : `<${n.name}${attrs}/>`;
  };
  return {
    $iq: (attrs: Record<string, string>) => builder(make('iq', attrs)),
    Strophe: {
      serialize,
      getDomainFromJid: (jid: string) => jid.split('@')[1]?.split('/')[0] ?? null,
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Strophe } = require('react-native-strophe') as { Strophe: { serialize(n: unknown): string } };

describe('XEP-0357 stanzas', () => {
  test('pubsub service JID is the virtual pubsub host on the user domain', () => {
    expect(pushServiceJid('42@jewelchat.net')).toBe('pubsub.jewelchat.net');
  });

  test('enable carries the publish-options form MongooseIM requires', () => {
    const xml = Strophe.serialize(buildPushEnableIq('42@jewelchat.net', 'jc-node', 'fcm-token-1').tree());
    expect(xml).toContain("<enable xmlns='urn:xmpp:push:0' jid='pubsub.jewelchat.net' node='jc-node'>");
    expect(xml).toContain("<x xmlns='jabber:x:data' type='submit'>");
    expect(xml).toContain(
      "<field var='FORM_TYPE'><value>http://jabber.org/protocol/pubsub#publish-options</value></field>",
    );
    expect(xml).toContain("<field var='device_id'><value>fcm-token-1</value></field>");
    expect(xml).toContain("<field var='service'><value>fcm</value></field>");
    expect(xml).toMatch(/^<iq [^>]*type='set'/);
  });

  test('disable targets the same node', () => {
    const xml = Strophe.serialize(buildPushDisableIq('42@jewelchat.net', 'jc-node').tree());
    expect(xml).toContain("<disable xmlns='urn:xmpp:push:0' jid='pubsub.jewelchat.net' node='jc-node'/>");
  });
});
