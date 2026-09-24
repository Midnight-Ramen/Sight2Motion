import { displayedX } from './CameraOrientation';
import type { SelectedSegment } from './SegmentationGeometry';
import { hasBoundingBox, type VisionResult } from './types';

/** Initial handoff only; live tracking retains its existing association algorithm. */
export function associateSelection(segment: SelectedSegment, detections: VisionResult[], mirror: boolean, initialIou = 0.35) {
  const b = segment.boundingBox, box = { ...b, x: displayedX(b.x, segment.width, mirror, b.width) };
  const cx = displayedX(segment.centroid.x, segment.width, mirror), cy = segment.centroid.y;
  // One summed-area table per refinement, then constant-time coverage per detection.
  const stride = segment.width + 1;
  const integral = segment.mask.length === segment.width * segment.height ? new Uint32Array(stride * (segment.height + 1)) : null;
  if (integral) for (let y = 0; y < segment.height; y++) {
    let row = 0;
    for (let x = 0; x < segment.width; x++) {
      row += segment.mask[y * segment.width + x] ? 1 : 0;
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row;
    }
  }
  const candidates = detections.filter(hasBoundingBox).filter(d =>
    [d.x,d.y,d.width,d.height,d.confidence].every(Number.isFinite) && d.width > 0 && d.height > 0).map(d => {
    const intersection = Math.max(0, Math.min(box.x + box.width,d.x+d.width)-Math.max(box.x,d.x)) *
      Math.max(0, Math.min(box.y+box.height,d.y+d.height)-Math.max(box.y,d.y));
    const boxArea=box.width*box.height, detectorArea=d.width*d.height;
    const iou=intersection/Math.max(1,boxArea+detectorArea-intersection);
    const contained=intersection/detectorArea;
    const centroidInside=cx>=d.x && cx<=d.x+d.width && cy>=d.y && cy<=d.y+d.height;
    const distance=Math.hypot(cx-d.x-d.width/2,cy-d.y-d.height/2)/Math.hypot(d.width,d.height);
    let coverage=intersection/Math.max(1,boxArea);
    if (integral) {
      const sx=displayedX(d.x,segment.width,mirror,d.width);
      const x0=Math.max(0,Math.min(segment.width,Math.floor(sx))), x1=Math.max(0,Math.min(segment.width,Math.ceil(sx+d.width)));
      const y0=Math.max(0,Math.min(segment.height,Math.floor(d.y))), y1=Math.max(0,Math.min(segment.height,Math.ceil(d.y+d.height)));
      const pixels=integral[y1*stride+x1]-integral[y0*stride+x1]-integral[y1*stride+x0]+integral[y0*stride+x0];
      coverage=pixels/Math.max(1,segment.area);
    }
    // Reject giant enclosing objects (e.g. person around a cup) on the relaxed path.
    const eligible=iou>=initialIou || (centroidInside && coverage>=0.8 && boxArea/detectorArea>=0.12 && distance<=0.45 && d.confidence>=0.3);
    const score=0.4*iou+0.25*coverage+0.15*contained+0.15*Math.max(0,1-distance)+0.05*d.confidence;
    return { detection:d, iou, contained, centroidInside, distance, coverage, score, eligible };
  }).filter(c=>c.eligible).sort((a,b)=>b.score-a.score);
  if (!candidates.length || (candidates[1] && candidates[0].score-candidates[1].score<0.04)) return null;
  return candidates[0];
}
