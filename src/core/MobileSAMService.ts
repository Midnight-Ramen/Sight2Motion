import type { MobileSAMSegmenter } from './MobileSAMSegmenter';
// One lazy worker/session per page. Panel/camera changes release the embedding,
// while retaining model sessions; navigation away closes browser-owned workers.
let service: Promise<MobileSAMSegmenter> | undefined;
export function mobileSAMService(): Promise<MobileSAMSegmenter> {
  return service ??= import('./MobileSAMSegmenter').then(({ MobileSAMSegmenter }) => new MobileSAMSegmenter())
    .catch(error => { service = undefined; throw error; });
}
