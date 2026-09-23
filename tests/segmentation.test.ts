import { expect, it } from 'vitest';
import { sourceClick, summarizeMask } from '../src/core/SegmentationGeometry';
it('maps letterboxed left/right clicks into source coordinates and reverses mirroring', () => {
  expect(sourceClick(100, 150, 800, 600, 640, 320, false)).toEqual({x:80,y:40});
  expect(sourceClick(100, 150, 800, 600, 640, 320, true)).toEqual({x:560,y:40});
  expect(sourceClick(700, 150, 800, 600, 640, 320, true)).toEqual({x:80,y:40});
  expect(sourceClick(100, 50, 800, 600, 640, 320, true)).toBeNull();
});
it('handles pillarboxing and rejects clicks outside the picture', () => {
  expect(sourceClick(100, 300, 800, 600, 300, 600, false)).toBeNull();
  expect(sourceClick(350, 300, 800, 600, 300, 600, true)).toEqual({x:200,y:300});
});
it('retains mask, source-pixel bounds, centroid and area without class labels', () => {
  const mask = new Uint8Array([0,1,1,0,0,1,1,0]);
  const result = summarizeMask(mask,4,2);
  expect(result.mask).toBe(mask);
  expect(result.boundingBox).toEqual({x:1,y:0,width:2,height:2});
  expect(result.centroid).toEqual({x:2,y:1}); expect(result.area).toBe(4);
  expect(() => summarizeMask(new Uint8Array(4),2,2)).toThrow('No object');
});
