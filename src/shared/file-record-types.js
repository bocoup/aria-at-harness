/**
 * @namespace FileRecord
 */

/**
 * @typedef FileRecord.Record
 * @property {FileRecord.NamedRecord[] | null} [entries] an array of NamedRecords or null if it should be removed
 * @property {Uint8Array | null} [buffer] a Uint8Array or null if it should be removed
 */

/**
 * @typedef FileRecord.NamedRecord
 * @property {string} name
 * @property {FileRecord.NamedRecord[] | null} [entries] an array of FileRecord.NamedRecord or null if it should be removed
 * @property {Uint8Array | null} [buffer] a Uint8Array or null if it should be removed
 */

/**
 * @typedef {function(FileRecord.Record, string[], FileRecord.Record[]): PromiseLike<FileRecord.Record> | FileRecord.Record} FileRecord.Functor
 */
