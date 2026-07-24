// L9_META: layer=security, role=workflow_spec_path_guard, status=active, version=1.0.0
import { copyFileSync, lstatSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
const args=Object.fromEntries(process.argv.slice(2).map(v=>{const i=v.indexOf('=');return i<0?[v.replace(/^--/,''),'']:[v.slice(2,i),v.slice(i+1)];}));
const input=args.input ?? process.env.SPEC_PATH_INPUT;
if(!input)throw new Error('--input or SPEC_PATH_INPUT is required');
if(isAbsolute(input) || input.split(/[\\/]+/).includes('..'))throw new Error('spec_path must be repository-relative and cannot contain traversal');
const root=realpathSync(process.cwd());
const candidate=resolve(root,input);
const real=realpathSync(candidate);
if(real!==root && !real.startsWith(`${root}${sep}`))throw new Error('spec_path escapes repository root');
const rel=relative(root,real).replaceAll('\\','/');
const allowed=['fixtures/','examples/','inputs/','domain_spec/'];
if(!allowed.some(prefix=>rel.startsWith(prefix)))throw new Error(`spec_path must be under ${allowed.join(', ')}`);
if(!['.yaml','.yml','.json'].includes(extname(real).toLowerCase()))throw new Error('spec_path extension must be yaml, yml, or json');
if(lstatSync(candidate).isSymbolicLink())throw new Error('spec_path cannot be a symlink');
const size=statSync(real).size;if(size<2||size>1024*1024)throw new Error('spec_path size is outside the allowed range');
const copyTo=args['copy-to'];if(copyTo){const out=resolve(root,copyTo);if(out!==root&&!out.startsWith(`${root}${sep}`))throw new Error('copy destination escapes repository root');mkdirSync(dirname(out),{recursive:true});copyFileSync(real,out);}
console.log(JSON.stringify({ok:true,source:rel,safe_copy:copyTo??null,size_bytes:size}));
