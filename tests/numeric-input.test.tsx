import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NumericInput, committedNumber } from '../src/components/NumericInput';
import { NumericSlider } from '../src/components/NumericSlider';
it.each([['20',0,20],['5',30,5],['',30,30],['',0,0],['020',0,20]])('normalizes a committed draft %s while retaining the previous value for empty drafts', (draft, previous, expected) => {
 expect(committedNumber(draft,previous)).toBe(expected);
});
it('clamps only the committed number to the caller bounds',()=>{
 expect(committedNumber('200',30,{min:0,max:100})).toBe(100);
 expect(committedNumber('-5',30,{min:1,max:100})).toBe(1);
 expect(committedNumber('',NaN,{min:0,max:180},90)).toBe(90);
});
it('honors explicit steps, decimals and step=any without inventing a new range',()=>{
 expect(committedNumber('777',750,{min:100,max:3000,step:50})).toBe(800);
 expect(committedNumber('0.137',.1,{min:0,max:1,step:.01})).toBe(.14);
 expect(committedNumber('1.25',0,{step:'any'})).toBe(1.25);
 expect(committedNumber('1.25',0)).toBe(1.25);
});
it('keeps number type, accessible labels and original slider bounds',()=>{
 const html=renderToStaticMarkup(<NumericSlider aria-label="Speed" min={0} max={100} step={1} value={30} onChange={()=>{}} />);
 expect(html).toContain('type="range"'); expect(html).toContain('type="number"');
 expect(html).toContain('aria-label="Speed"'); expect(html).toContain('aria-label="Speed slider"');
 expect(html.match(/value="30"/g)).toHaveLength(2);
 expect(renderToStaticMarkup(<NumericInput defaultValue={90} min={0} max={180} />)).toContain('value="90"');
});
