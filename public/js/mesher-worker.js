// 形のメッシュ化をメインスレッドの外で行う
import { meshFromSpec } from "./sdf.js";

self.onmessage = (e) => {
  const { id, spec } = e.data;
  try {
    const m = meshFromSpec(spec);
    self.postMessage({ id, ...m }, [m.positions.buffer, m.normals.buffer, m.indices.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
