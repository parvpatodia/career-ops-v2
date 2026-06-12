/**
 * Renders the projection to data/applications.json (the view required by
 * the global logging rule). Write is atomic: tmp file, fsync, rename.
 * WHY: the view may be regenerated at any moment; a crash mid-write must
 * leave the previous view intact, never a truncated file.
 */

import fs from 'fs';
import path from 'path';
import type { Projection } from './Projection.js';

export class ViewWriter {
  write(proj: Projection, viewPath: string): void {
    fs.mkdirSync(path.dirname(viewPath), { recursive: true });
    const json = JSON.stringify(proj.all(), null, 2) + '\n';
    // WHY unique tmp name: two processes writing the same fixed tmp path
    // can rename a half-written file into place (review 2026-06-11).
    const tmpPath = `${viewPath}.${process.pid}.${Date.now()}.tmp`;

    const fd = fs.openSync(tmpPath, 'w');
    try {
      fs.writeSync(fd, json);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }

    try {
      fs.renameSync(tmpPath, viewPath);
    } catch (err) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // Best-effort cleanup; the failed rename is the error that matters.
      }
      throw err;
    }
  }
}
