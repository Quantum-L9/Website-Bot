// L9_META: layer=validation, role=json_schema_2020_compiler, status=active, version=2.0.0
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
const directory=resolve('schemas');
const required={
 'assembly-manifest.schema.json':'website-bot.assembly-manifest/v2',
 'build-proof.schema.json':'website-bot.build-proof/v2',
 'publication-evidence.schema.json':'website-bot.publication-evidence/v2',
 'deployment-evidence.schema.json':'website-bot.deployment-evidence/v2',
 'release-receipt.schema.json':'website-bot.release-receipt/v2',
 'evidence-index.schema.json':'website-bot.evidence-index/v2',
 'stage-checkpoint.schema.json':'website-bot.stage-checkpoint/v2',
 'stage-failure-evidence.schema.json':'website-bot.stage-failure/v2',
 'seo-bot-registration-ack.schema.json':'seo-bot.website-factory-registration-ack/v1',
 'provisioning-receipt.schema.json':'website-bot.provisioning-receipt/v1',
};
const snake=/^[a-z][a-z0-9_]*$/;
function resolveRef(root,ref){if(!ref.startsWith('#/'))throw new Error(`external $ref not allowed: ${ref}`);return ref.slice(2).split('/').reduce((v,k)=>v?.[k.replaceAll('~1','/').replaceAll('~0','~')],root);}
function compile(root){
 const validate=(schema,value,path='$')=>{
  if(schema.$ref)return validate(resolveRef(root,schema.$ref),value,path);
  if('const'in schema&&value!==schema.const)return `${path} must equal const`;
  if(schema.enum&&!schema.enum.includes(value))return `${path} must be in enum`;
  if(schema.type==='object'){
   if(!value||typeof value!=='object'||Array.isArray(value))return `${path} must be object`;
   for(const key of schema.required??[])if(!(key in value))return `${path}.${key} is required`;
   if(schema.additionalProperties===false)for(const key of Object.keys(value))if(!(key in (schema.properties??{})))return `${path}.${key} is not allowed`;
   for(const [key,child] of Object.entries(schema.properties??{}))if(key in value){const e=validate(child,value[key],`${path}.${key}`);if(e)return e;}
  }
  if(schema.type==='array'){
   if(!Array.isArray(value))return `${path} must be array`;
   if(value.length<(schema.minItems??0))return `${path} has too few items`;
   for(let i=0;i<value.length;i++){const e=validate(schema.items??{},value[i],`${path}[${i}]`);if(e)return e;}
  }
  if(schema.type==='string'){
   if(typeof value!=='string')return `${path} must be string`;
   if(value.length<(schema.minLength??0))return `${path} is too short`;
   if(schema.pattern&&!new RegExp(schema.pattern).test(value))return `${path} does not match pattern`;
   if(schema.format==='date-time'&&Number.isNaN(Date.parse(value)))return `${path} must be date-time`;
  }
  if(schema.type==='integer'&&(!Number.isInteger(value)||value<(schema.minimum??-Infinity)||value>(schema.maximum??Infinity)))return `${path} must be integer in range`;
  if(schema.type==='number'&&(typeof value!=='number'||value<(schema.minimum??-Infinity)||value>(schema.maximum??Infinity)))return `${path} must be number in range`;
  if(schema.type==='boolean'&&typeof value!=='boolean')return `${path} must be boolean`;
  return null;
 };
 return value=>{const error=validate(root,value);return {valid:!error,error};};
}
function sample(root,schema=root){
 if(schema.$ref)return sample(root,resolveRef(root,schema.$ref));
 if('const'in schema)return schema.const;if(schema.enum)return schema.enum[0];
 if(schema.type==='object'){const out={};for(const key of schema.required??[])out[key]=sample(root,schema.properties?.[key]??{});return out;}
 if(schema.type==='array')return Array.from({length:schema.minItems??0},()=>sample(root,schema.items??{}));
 if(schema.type==='boolean')return true;if(schema.type==='integer'||schema.type==='number')return schema.minimum??1;
 if(schema.type==='string'){
  if(schema.format==='date-time')return '2026-07-21T00:00:00.000Z';
  const p=schema.pattern??'';
  if(p.includes('\\d+\\.\\d+\\.\\d+'))return '1.0.0';
  if(p.includes('{64}'))return 'a'.repeat(64);
  if(p.includes('{40}'))return 'a'.repeat(40);
  if(p.includes('env://'))return 'env://TEST_SECRET';
  if(p.includes('https'))return 'https://example.test';
  if(p.includes('\/'))return 'owner/repository';
  if(p.includes('^/'))return '/';
  if(p.includes('A-Za-z0-9._\/-'))return 'main';
  return 'x'.repeat(Math.max(1,schema.minLength??1));
 }
 return {};
}
const results=[];
for(const [file,schemaConst] of Object.entries(required)){
 const doc=JSON.parse(readFileSync(resolve(directory,file),'utf8'));
 if(doc.$schema!=='https://json-schema.org/draft/2020-12/schema')throw new Error(`${file}: wrong meta-schema`);
 if(doc.type!=='object'||doc.additionalProperties!==false)throw new Error(`${file}: object must fail closed`);
 if(doc.properties?.schema?.const!==schemaConst)throw new Error(`${file}: schema const drift`);
 const camel=[];const scan=node=>{if(!node||typeof node!=='object')return;if(node.properties)for(const key of Object.keys(node.properties)){if(!snake.test(key))camel.push(key);scan(node.properties[key]);}if(node.$defs)for(const child of Object.values(node.$defs))scan(child);if(node.items)scan(node.items);};scan(doc);
 if(camel.length)throw new Error(`${file}: non-snake_case persisted fields: ${[...new Set(camel)].join(', ')}`);
 const validator=compile(doc);const positive=sample(doc);const pass=validator(positive);if(!pass.valid)throw new Error(`${file}: generated positive fixture failed: ${pass.error}`);
 const negative={...positive};delete negative.schema;const fail=validator(negative);if(fail.valid)throw new Error(`${file}: negative fixture unexpectedly passed`);
 results.push({file,schema:schemaConst,positive_fixture:'passed',negative_fixture:'rejected'});
}
const extras=readdirSync(directory).filter(name=>name.endsWith('.schema.json')&&!(name in required));
console.log(JSON.stringify({ok:true,draft:'2020-12',validated:results,additionalSchemas:extras.sort()},null,2));
