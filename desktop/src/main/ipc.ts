import { registerLibraryHandlers } from './ipc/library';
import { registerMediaHandlers } from './ipc/media';
import { registerQueueHandlers } from './ipc/queue';
import { pauseAllJobs, resumeAllJobs, shutdownActiveJob } from './ipc/runtime';
import { registerSettingsHandlers } from './ipc/settings';
import { registerWorksHandlers } from './ipc/works';
import { loadStore } from './queue';

export { pauseAllJobs, resumeAllJobs, shutdownActiveJob };

export function registerIpcHandlers(): void {
  void loadStore();

  registerSettingsHandlers();
  registerWorksHandlers();
  registerMediaHandlers();
  registerQueueHandlers();
  registerLibraryHandlers();
}
