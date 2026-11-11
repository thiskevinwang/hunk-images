// Published 0.24.1 declarations predate the documented API 33 addition.
import 'hunkdiff/extension';
declare module 'hunkdiff/extension' {
  interface ExtensionFileViewInput {
    readBytes(side: 'old' | 'new'): Promise<Uint8Array | null>;
  }
}
