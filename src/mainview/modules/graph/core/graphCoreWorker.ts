import { runGraphCore } from "./graphCore";

import type { ReferenceGraph } from "./graphTypes";

self.onmessage = (event: MessageEvent<ReferenceGraph>) => {
  self.postMessage(runGraphCore(event.data));
};
