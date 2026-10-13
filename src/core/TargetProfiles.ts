import type { SelectedSegment } from './SegmentationGeometry';
export const TARGET_PROFILE_LIMITS = { profiles: 10, views: 8, totalViews: 16, cropSide: 64 } as const;
export interface AppearanceTemplate {
  width: number; height: number; box: SelectedSegment['boundingBox'];
  samples: { u: number; v: number; rgb: number[]; weight: number }[];
}
export interface TargetReference {
  id: string;
  crop: { image: string; mask: string; width: number; height: number };
  appearance: AppearanceTemplate;
}
export interface TargetProfile { label: string; references: TargetReference[]; matchThreshold: number }
export function migrateTargetProfiles(profiles: TargetProfile[] = [], names: string[] = []): TargetProfile[] {
  const result = profiles.map(p => ({ ...p, references: [...p.references] }));
  for (const label of [...new Set(names.map(n => n.trim()).filter(Boolean))])
    if (!result.some(p => p.label === label)) result.push({ label, references: [], matchThreshold: .7 });
  return result;
}
export function saveTargetView(profiles: TargetProfile[], label: string, reference: TargetReference): TargetProfile[] {
  label = label.trim();
  if (!label || label.length > 80) throw new Error('Enter a target label (up to 80 characters).');
  const previous = profiles.find(p => p.label === label);
  if (!previous && profiles.length >= TARGET_PROFILE_LIMITS.profiles) throw new Error('Remove a target before adding another.');
  if ((previous?.references.length ?? 0) >= TARGET_PROFILE_LIMITS.views || profiles.reduce((n,p)=>n+p.references.length,0) >= TARGET_PROFILE_LIMITS.totalViews)
    throw new Error('Remove a reference view before adding another.');
  const next = { label, references: [...(previous?.references ?? []), reference], matchThreshold: previous?.matchThreshold ?? .7 };
  return previous ? profiles.map(p => p.label === label ? next : p) : [...profiles, next];
}
export function removeTargetView(profiles: TargetProfile[], label: string, id: string): TargetProfile[] {
  return profiles.map(p => p.label === label ? { ...p, references: p.references.filter(r=>r.id!==id) } : p);
}
/** Bounded, schema-only import. No image URLs, model weights or executable content are accepted. */
export function parseTargetProfiles(value: unknown): TargetProfile[] {
  if (!Array.isArray(value) || value.length > TARGET_PROFILE_LIMITS.profiles) throw new Error('Target profiles are not valid.');
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v==='object' && !Array.isArray(v);
  const number = (v: unknown, min: number, max: number): v is number => typeof v==='number' && Number.isFinite(v) && v>=min && v<=max;
  const labels = new Set<string>(), ids = new Set<string>(); let total = 0;
  return value.map(p => {
    if (!object(p) || typeof p.label!=='string' || !p.label.trim() || p.label.length>80 || labels.has(p.label.trim()) || !Array.isArray(p.references) || p.references.length>TARGET_PROFILE_LIMITS.views || !number(p.matchThreshold ?? .7,.01,1)) throw new Error('Target profile settings are not valid.');
    labels.add(p.label.trim()); total+=p.references.length;
    if(total>TARGET_PROFILE_LIMITS.totalViews) throw new Error('Too many target reference views.');
    const references = p.references.map(r => {
      if(!object(r) || typeof r.id!=='string' || !r.id || r.id.length>100 || ids.has(r.id) || !object(r.crop) || !object(r.appearance)) throw new Error('Target reference is not valid.');
      ids.add(r.id); const c=r.crop, a=r.appearance;
      if(!Number.isInteger(c.width)||!number(c.width,1,64)||!Number.isInteger(c.height)||!number(c.height,1,64)||typeof c.image!=='string'||c.image.length>33000||!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(c.image)||typeof c.mask!=='string'||! /^[A-Za-z0-9+/]+=*$/.test(c.mask)||c.mask.length!==4*Math.ceil(c.width*c.height/3)) throw new Error('Target crop is not valid.');
      const image=atob(c.image.slice('data:image/png;base64,'.length)), mask=atob(c.mask);
      const dimension=(offset:number)=>[0,1,2,3].reduce((n,i)=>n*256+image.charCodeAt(offset+i),0);
      if(image.length<33 || [...[137,80,78,71,13,10,26,10]].some((v,i)=>image.charCodeAt(i)!==v) || image.slice(12,16)!=='IHDR' || dimension(16)!==c.width || dimension(20)!==c.height || mask.length!==c.width*c.height || [...mask].some(v=>v.charCodeAt(0)>1)) throw new Error('Target crop pixels are not valid.');
      if(!number(a.width,1,4096)||!number(a.height,1,4096)||!object(a.box)||!number(a.box.x,0,a.width)||!number(a.box.y,0,a.height)||!number(a.box.width,5,a.width)||!number(a.box.height,5,a.height)||a.box.x+a.box.width>a.width+1||a.box.y+a.box.height>a.height+1||!Array.isArray(a.samples)||a.samples.length<20||a.samples.length>196) throw new Error('Target matching representation is not valid.');
      const samples=a.samples.map(s=>{
        if(!object(s)||!number(s.u,-.1,1.1)||!number(s.v,-.1,1.1)||!number(s.weight,.01,1)||!Array.isArray(s.rgb)||s.rgb.length!==3||s.rgb.some(v=>!number(v,0,255))) throw new Error('Target samples are not valid.');
        return {u:s.u,v:s.v,weight:s.weight,rgb:[...s.rgb] as number[]};
      });
      return {id:r.id,crop:{image:c.image,mask:c.mask,width:c.width,height:c.height},appearance:{width:a.width,height:a.height,box:{x:a.box.x,y:a.box.y,width:a.box.width,height:a.box.height},samples}};
    });
    return {label:p.label.trim(),matchThreshold:(p.matchThreshold ?? .7) as number,references};
  });
}
