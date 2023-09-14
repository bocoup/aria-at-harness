import ws from 'ws';

import { iterateEmitter } from '../shared/iterate-emitter.js';
import { AgentMessage } from './messages.js';

/**
 * @param {object} options
 * @param {object} [options.url]
 * @param {string} [options.url.hostname]
 * @param {string} [options.url.pathname]
 * @param {number | string} [options.url.port]
 * @param {object} options.abortSignal
 * @returns {Promise<ATDriver>}
 */
export async function createATDriver({
  url: { hostname = 'localhost', port = 4382, pathname = '/session' } = {},
  abortSignal,
  log,
} = {}) {
  if (!abortSignal) process.exit(1);
  const url = `ws://${hostname}:${port}${pathname}`;
  log(AgentMessage.AT_DRIVER_COMMS, { direction: 'connect', message: url });
  const socket = new ws(url);
  const driver = new ATDriver({ socket, log });
  await driver.ready;
  abortSignal.then(() => driver.quit());
  return driver;
}

export class ATDriver {
  constructor({ socket, log }) {
    this.socket = socket;
    this.log = log;
    this.ready = new Promise(resolve => socket.once('open', () => resolve())).then(() =>
      socket.send(JSON.stringify({ method: 'session.new', params: { capabilities: {} } }))
    );
    this.closed = new Promise(resolve => socket.once('close', () => resolve()));

    this._nextId = 0;
  }

  async quit() {
    this.log(AgentMessage.AT_DRIVER_COMMS, { direction: 'close' });
    this.socket.close();
    await this.closed;
  }

  async *_messages() {
    for await (const rawMessage of iterateEmitter(this.socket, 'message', 'close', 'error')) {
      this.log(AgentMessage.AT_DRIVER_COMMS, { direction: 'inbound', message: rawMessage });
      yield JSON.parse(rawMessage.toString());
    }
  }

  async _send(command) {
    const id = (this._nextId++).toString();
    const rawMessage = JSON.stringify({ id, ...command });
    this.log(AgentMessage.AT_DRIVER_COMMS, { direction: 'outbound', message: rawMessage });
    this.socket.send(rawMessage);
    for await (const message of this._messages()) {
      if (message.id === id) {
        if (message.error) {
          throw new Error(message.error);
        }
        return;
      }
    }
  }

  /**
   * @param  {...(ATKey | ATKeyChord | ATKeySequence)} keys
   */
  async sendKeys(...keys) {
    for (const chord of ATKey.sequence(...keys)) {
      for (const { key } of chord) {
        await this._send({
          method: 'interaction.pressKeys',
          params: { keys: chord.keys.map(({ mapped }) => mapped) },
        });
      }
    }
  }

  /**
   * @returns {AsyncGenerator<string>}
   */
  async *speeches() {
    for await (const message of this._messages()) {
      if (message.method === 'interaction.capturedOutput') {
        yield message.params.data;
      }
    }
  }
}

const seleniumKeysMap = {
  NULL: '\ue000',
  CANCEL: '\ue001',
  HELP: '\ue002',
  BACKSPACE: '\ue003',
  TAB: '\ue004',
  CLEAR: '\ue005',
  RETURN: '\ue006',
  ENTER: '\ue007',
  SHIFT: '\ue008',
  CONTROL: '\ue009',
  ALT: '\ue00a',
  PAUSE: '\ue00b',
  ESCAPE: '\ue00c',
  SPACE: '\ue00d',
  PAGE_UP: '\ue00e',
  PAGE_DOWN: '\ue00f',
  END: '\ue010',
  HOME: '\ue011',
  LEFT: '\ue012',
  UP: '\ue013',
  RIGHT: '\ue014',
  DOWN: '\ue015',
  INSERT: '\ue016',
  DELETE: '\ue017',
  SEMICOLON: '\ue018',
  EQUALS: '\ue019',

  NUMPAD0: '\ue01a',
  NUMPAD1: '\ue01b',
  NUMPAD2: '\ue01c',
  NUMPAD3: '\ue01d',
  NUMPAD4: '\ue01e',
  NUMPAD5: '\ue01f',
  NUMPAD6: '\ue020',
  NUMPAD7: '\ue021',
  NUMPAD8: '\ue022',
  NUMPAD9: '\ue023',
  MULTIPLY: '\ue024',
  ADD: '\ue025',
  SEPARATOR: '\ue026',
  SUBTRACT: '\ue027',
  DECIMAL: '\ue028',
  DIVIDE: '\ue029',

  F1: '\ue031',
  F2: '\ue032',
  F3: '\ue033',
  F4: '\ue034',
  F5: '\ue035',
  F6: '\ue036',
  F7: '\ue037',
  F8: '\ue038',
  F9: '\ue039',
  F10: '\ue03a',
  F11: '\ue03b',
  F12: '\ue03c',

  META: '\ue03d',
  COMMAND: '\ue03d',
  ZENKAKU_HANKAKU: '\ue040',
};

export class ATKey {
  /**
   * @param {string} key
   */
  constructor(key) {
    this.type = 'key';
    this.key = key;
    this.mapped = seleniumKeysMap[this.key.toUpperCase()] ?? this.key;
  }
  toString() {
    return this.key;
  }
  static get ENTER() {
    return new ATKey('enter');
  }
  /**
   * @param {string} key
   * @returns {ATKey}
   */
  static key(key) {
    return new ATKey(key);
  }
  /**
   * @param  {...ATKey} keys
   * @returns {ATKeyChord}
   */
  static chord(...keys) {
    return new ATKeyChord(keys);
  }
  /**
   * @param  {...(ATKey | ATKeyChord | ATKeySequence)} sequence
   * @returns {ATKeySequence}
   */
  static sequence(...sequence) {
    /** @type {ATKeyChord[]} */
    const normalized = [];
    for (const item of sequence) {
      if (item instanceof ATKeyChord) {
        normalized.push(item);
      } else if (item instanceof ATKey) {
        normalized.push(ATKey.chord(item));
      } else if (item instanceof ATKeySequence) {
        normalized.push(...item);
      }
    }
    return new ATKeySequence(normalized);
  }
}

export class ATKeyChord {
  /**
   * @param {ATKey[]} keys
   */
  constructor(keys) {
    this.type = 'chord';
    this.keys = keys;
  }

  *[Symbol.iterator]() {
    yield* this.keys;
  }

  toString() {
    return this.keys.join(' + ');
  }
}

export class ATKeySequence {
  /**
   * @param {ATKeyChord[]} sequence
   */
  constructor(sequence) {
    this.type = 'sequence';
    this.sequence = sequence;
  }

  *[Symbol.iterator]() {
    yield* this.sequence;
  }

  toString() {
    return this.sequence.join(', ');
  }
}
