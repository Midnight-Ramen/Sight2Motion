import type { SelectedSegment } from '../core/SegmentationGeometry';
import { TARGET_PROFILE_LIMITS, type AppearanceTemplate, type TargetReference } from '../core/TargetProfiles';
export function captureTargetReference(frame: HTMLCanvasElement, selection: SelectedSegment, appearance: AppearanceTemplate): TargetReference {
  const box=selection.boundingBox, scale=Math.min(1,TARGET_PROFILE_LIMITS.cropSide/Math.max(box.width,box.height));
  const width=Math.max(1,Math.round(box.width*scale)), height=Math.max(1,Math.round(box.height*scale));
  const crop=document.createElement('canvas');crop.width=width;crop.height=height;
  crop.getContext('2d')!.drawImage(frame,box.x,box.y,box.width,box.height,0,0,width,height);
  const mask=new Uint8Array(width*height);
  // Preserve thin selected regions when reducing the mask to thumbnail dimensions.
  for(let sy=Math.floor(box.y);sy<Math.ceil(box.y+box.height);sy++)for(let sx=Math.floor(box.x);sx<Math.ceil(box.x+box.width);sx++) {
    if(!selection.mask[sy*selection.width+sx])continue;
    const x=Math.min(width-1,Math.floor((sx-box.x)*width/box.width)), y=Math.min(height-1,Math.floor((sy-box.y)*height/box.height));
    if(x>=0&&y>=0)mask[y*width+x]=1;
  }
  return {id:crypto.randomUUID(),crop:{image:crop.toDataURL('image/png'),mask:btoa(String.fromCharCode(...mask)),width,height},appearance};
}
