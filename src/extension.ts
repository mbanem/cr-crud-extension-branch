
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
// to find the work folder path
import * as child_process from 'child_process';

let rootPath = '';
let routesPath = '';
let routeName_ ='';
let routeCName = '';    // capitalized
let fields_:string[]=[];
let embellishments_:string[]=[];
let terminal: vscode.Terminal | undefined;
let noPrismaSchema = false;
let installPartTwoPending = false;
let pm = 'unknown';
let ex = 'unknown';
// {} has [key,value] easy to select a model via key
// for (const [modelName, fields] of Object.entries(models)) {   // iterating
type Models = {
  [modelName: string]: string[];
}
const modelsFieldNames: Models = {};
function fNamesList(){
  let fList = ``
  for(const field of fields_){
    fList += `${field.split(':')[0]}, `;
  }
  return fList.slice(0,-2)
}
function fieldTypeList(){
  let fieldTypeList = ``
  for(const field of fields_){
    fieldTypeList += `${field}
    `
	}
	return fieldTypeList.slice(0,-4);
}
function passwordHashAndToken(){
	if (routeName_ !== 'user') return;
	return `passwordHash: await bcrypt.hash(password, 10),
				userAuthToken: crypto.randomUUID()
		`.slice(0,-3)
}
function getServerPage(){
  let imp = `import { db } from '$lib/server/db';
import type { PageServerLoad } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import type RequestEvent from '@sveltejs/kit';
import type { Actions } from '@sveltejs/kit';
import bcrypt from 'bcrypt'
import * as utils from '$lib/utils';;
import { fail } from '@sveltejs/kit';

export const load: PageServerLoad = (async ({}) => {
	const ${routeName_}s = await db.${routeName_}.findMany({
		select:{
      ${fNamesList().replace(/password,/,'').replace(/\s+/g, '').replace(/,/g, `: true,
      `)+ ': true'}
		}
  });
	if (! ${routeName_}s) {
		return fail(400, { message: 'No  ${routeName_}s in db' });
	}
	return {
		${routeName_}s
	};
}) satisfies PageServerLoad;

export const actions: Actions = {
	create: async ({ request }) => {
    const { ${fNamesList()} } = Object.fromEntries(
		// @ts-expect-error
		await request.formData()
	) as {
    ${fieldTypeList()}
	};
	if (!(${fNamesList().replace(/,/g, ' &&')})) {
		return fail(400, {
			data: {
				${fNamesList().replace(/password,?/,'')}
			},
			message: 'Insufficient data supplied'
		})
	}
	const ${routeName_}Exists = await db.${routeName_}.findFirst({
			where: {
				${fNamesList()}
			}
		})
		if (${routeName_}Exists) {
			return fail(400, {
				data: { ${fNamesList().replace(/password,?/,'')} },
				message: 'Unacceptable data'
			})
		} else {
			const ${routeName_} = await db.${routeName_}.create({
				data: {
					${fNamesList()},
					${passwordHashAndToken()}
				}
			})
		}
		return {
			success: true,
			message: '${routeName_} created successfully'
		}
  }
} satisfies Actions
`
	return imp;
}
const schemaWhatToDo = `/*
MAKE YOUR PRISMA SCHEMA MODELS HERE
As databases could have stronger requests for naming tables and columns
use Prisma modification operators for renaming TypeScript model names
into new database names like
    model User {
      id      			String   @id @default(uuid())
      firstName    	String   @map("first_name")
      createdAt DateTime @default(now())   @map("created_at")
      @@map("users")
    }
Now in your program you use firstName but in db it is the first_name
and the table in program is User but in db users thanks to the operators
@map first_name and @@map users, as some db have
internal user table so we use plural instead.
*/`

const envWhatToDo = `# Environment variables declared in this file are automatically made available to Prisma.
// See the documentation for more detail: https://pris.ly/d/prisma-schema//accessing-environment-variables-from-the-schema

// Prisma supports the native connection string format for PostgreSQL, MySQL, SQLite, SQL Server, MongoDB and CockroachDB.
// See the documentation for all the connection string options: https://pris.ly/d/connection-strings

// example is for PostgreSQL, change values wrapped in
// username is a Role in PostgreSQL
// password is username's db password
// dbName is database name to connect to
DATABASE_URL="postgresql://username:password@localhost:5432/dbName?schema=public"

// see docs for how to use SECRET_API_KEYs
SECRET_APT_KEY="kiki:kiki@localhost:5432
SECRET_APT_ENV=development
SECRET_API_KEY=1234567890`;

const sleep = async (ms: number) => {
    return new Promise((resolve) => {
      setTimeout(() => {
        // ms here is a dummy but required by
        // resolve to send out some value
        resolve(ms)
      }, ms)
    })
  }
function createDBExportFile(){
  const exportDbPath = path.join(rootPath, '/src/lib/server/db.ts');
  if (!fs.existsSync(exportDbPath)){
    fs.writeFileSync(exportDbPath, `import { PrismaClient } from '@prisma/client';

// export const db = new PrismaClient();
export const db = new PrismaClient({
	log: ['warn', 'error']
});
// log: ['query', 'info', 'warn', 'error']`)
  }
}
function createPendingFile(){
  const pendingFile = path.join(rootPath, '/prisma/installPartTwo.pending');
  if (!fs.existsSync(pendingFile)){
    fs.writeFileSync(pendingFile, 'install Prisma PartOne is done.\nInstallPartTwo is pending but may be already done by User.')
  }
}
function deletePendingFile(){
  const pendingFile = path.join(rootPath, '/prisma/installPartTwo.pending');
  if (fs.existsSync(pendingFile)){
    fs.unlink(pendingFile, (err) => {
      if (err) {
        vscode.window.showInformationMessage('Could not delete installPartTwo.pending file at /prisma. Delete it yourself');
      }
    });
  }
}
type PMErr = { err: string };
function detectPackageManager(): 'npm' | 'pnpm' | 'yarn' | 'bun' | PMErr  {

    if (fs.existsSync(path.join(rootPath, 'pnpm-lock.yaml'))) return pm='pnpm';
    if (fs.existsSync(path.join(rootPath, 'yarn.lock'))) return pm='yarn';
    if (fs.existsSync(path.join(rootPath, 'bun.lockb'))) return pm='bun';
    if (fs.existsSync(path.join(rootPath, 'package-lock.json'))) return pm='npm';

    return {err: 'unknown'};
}
function xPackageManager(pm: string): 'npx' | 'pnpx' | 'yarn dlx' | 'bunx' | 'unknown'{
  switch(pm){
    case 'npm': return ex='npx';
    case 'pnpm': return ex='pnpx';
    case 'bun': return ex='bunx';
    case 'yarn': return ex='yarn dlx';
    default: return ex='unknown';
  }
}

// Promise wrapper for child_process.exec
function execShell(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
        child_process.exec(cmd, { cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath }, (err, stdout, stderr) => {
            if (err) {
                reject(new Error(`Command failed: ${stderr}`));
                return;
            }
            resolve(stdout);
        });
    });
}

function sendToTerminal(cmd: string) {
  if (!terminal) {
    terminal = vscode.window.createTerminal(`WebView Terminal`);
  }
  terminal.show(true); // reveal the terminal
  terminal.sendText(cmd);
}

function ensureComponentPath(){
  // console.log('embellishments_', embellishments_)
  try{
    const componentsPath = path.join(rootPath as string, '/src/lib/components');
    if (!fs.existsSync(componentsPath)) {
      fs.mkdirSync(componentsPath, { recursive: true });
    }
    return componentsPath;
  }catch(err){
    console.log(err)
    return false;
  }
}

function noType(name: string){
  return name.match(/([a-zA-z0-9_]+)\:?.*/)?.[1]
}
let buttons = `<div class='buttons'>
      `;
function buttons_(){
  const spinner: boolean = embellishments_.includes('CRSpinner');
  ['create', 'update', 'delete'].forEach((caption) => {
    // console.log('buttons_()', caption)
    const cap = caption[0].toUpperCase() + caption.slice(1)
    const hid = cap !== 'Create';
    if(spinner){
      buttons += `    <CRSpinner
            bind:button={btn${cap}}
            spinOn={loading}
            caption=${caption}
            formaction="?/${caption}"
            disabled={!formDataValid}
            hidden={!formDataValid}
          >
          </CRSpinner>
          `
    }else{
      buttons += `<button bind:this={btn${cap}} name="${caption}" formaction="?/${caption}">${caption}</button>
          `
    }
        buttons + `</div>
      `
    })
    return '';  // called as ()=>void with no return output is 'undefined'
}

function asType(type:string){
  console.log('asType type:', type);
  switch(type){
    case 'string':{
      return 'as string';
    }
    case 'number':{
      return 'as number';
    }
    case 'boolean':{
      return 'as boolean';
    }
  }
  return ''
}

function inputType(name:string,type:string){
  name = name.toLowerCase();
  type = type.toLowerCase();
  if (name==='password'){
    return 'password';
  }
  if (type==='number'){
    return 'number';
  }
  return 'text';
}

function toCapitalize(name:string, type:string){
  console.log('toCapitalize','name',name,'type',type)
  if ('id|password|email'.includes(name.toLowerCase())){
    console.log('FALSE')
    return false;
  }
  console.log('TRUE')
  return true;
}

function inputBox(name:string, type: string){
  if (embellishments_.includes('CRInput')){
    return `<CRInput title="${name}"
        exportValueOn="enter|blur"
        type='${inputType(name, type)}'
        capitalize={${toCapitalize(name,type)}}
        bind:value={snap.${name} ${asType(type)}}
        required={true}
        width='22.5rem'
      >
      </CRInput>
      `
  }
  return `<input type="hidden" name="${name}" bind:value={snap.${name}} />
  `
}

function submitFunc(){
  return
}

/* 
function toArray(fields_: string[]){
  const fields:string[] = [];
  fields_.forEach(str => {
    fields.push(`"${str}"`);
  })
  return fields;
}
*/
let theInitValues: string[] = [];
function initValues(){
  let updateFields = ``
  let partialType = `type ${routeCName}Partial = {
  id: string | null
  `;
  let clean_snap = '';
  const fields: string[] = [];
  fields_.forEach(fName => {
    let [ , name, type] = fName.match(/(.+):\s*(\S+)/)?.map((m:string,index:number) => index===2 ? m.toLowerCase() : m); 
    updateFields += `${name}: u.${name},
          `
    clean_snap += name + `: null,
  `;
    if (!fields.includes('id:string')){
      fields.push(`
  id: null`);
    }
    if (type.includes('[]')){
      type = 'array'
    }
    type = type.replace(/\?/g,'');
    switch(type){
      case 'string':{
        fields.push(`
  ${name}: null`);
  if (name !== 'id'){
  partialType += `${name}: string | null
  `
  }
        break;
      }
      case 'number':{
        fields.push(`
  ${name}: 0`);
  partialType += `${name}: number | null
  `
        break;
      }
      case 'date':{
        fields.push(`
  ${name}: null`);
  partialType += `${name}: Date | null
  `
        break;
      }
      case 'boolean':{
        fields.push(`
  ${name}: false`);
  partialType += `${name}: boolean | null
  `
        break;
      }
      case 'array':{
        fields.push(`
  ${name}: []`);
  partialType += `${name}: array | []
  `
        break;
      }
      case 'role':{
        fields.push(`
  ${name}: 'VISITOR'`);
  partialType += `${name}: Types.Role | null
  `
        break;
      }
      default:{
        fields.push(`
  ${name}: ${type}`);
  partialType += `${name}: ${type} | null_xx
  `
        break;
      }
    }
  })
  clean_snap = clean_snap.replace(/,\s*$/,'')
  partialType = partialType.slice(0,-3) + `
}`
  updateFields = updateFields.replace(/u\.password/, "''").slice(0,-11);

  theInitValues = [clean_snap, partialType, updateFields];
}

function nullType(fName:string){
  let [ , name, type] = fName.match(/(.+):\s*(\S+)/)?.map((m:string,index:number) => index===2 ? m.toLowerCase() : m);
  // fName includes type and we added | null
  if (type.includes('[]')){
    return fName + ' | []';
  }else if(!'String|Number|Boolean|Date'.includes(type)){
    return fName + ' | null';
  }
}

let importTypes = 'import type {';
function createFormPage(includeTypes: string, outputChannel: any){
  outputChannel.appendLine('createFormPage entry point routesPath: '+ routesPath); outputChannel.show();
  const routeNamePath = path.join(routesPath, routeName_)
  if (!fs.existsSync(routeNamePath)) {
    outputChannel.appendLine('create routeNamePath: '+ routeNamePath); outputChannel.show();
    fs.mkdirSync(routeNamePath, { recursive: true });
  }

  let inputBoxes = '';

  fields_.forEach(fName=>{
    let [ , name, type] = fName.match(/(.+):\s*(\S+)/)?.map((m:string,index:number) => index===2 ? m.toLowerCase() : m);

    inputBoxes += inputBox(name, type)
  })
  let imports= ''
  embellishments_.forEach(comp => {
    imports += `import ${comp} from '$lib/components/${comp}.svelte';
`
})
let cr_Activity = ''
if (embellishments_.includes('CRActivity')){
  cr_Activity = `<CRActivity
  PageName='${routeName_}'
  bind:result
  bind:selected${routeCName}Id
  ${routeName_}={data.locals.${routeName_}}
  ${routeName_}s={data.${routeName_}s}
></CRActivity>`
}
  
initValues();
let plusPageSvelte = `<script lang="ts">
// ${routeName_}/+page.svelte
import type { Snapshot } from '../$types';
import { onMount } from 'svelte';
import type { PageData, ActionData } from './$types';
import type { SubmitFunction } from '@sveltejs/kit';
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import { page } from '$app/state'; // for page.status code on actions

import * as utils from '$lib/utils';
import * as Types from '$lib/types/types';
` + imports +

`
type ARGS = {
  data: PageData;
  form: ActionData;
};
let { data, form }: ARGS = $props();

${theInitValues[1]}
let nullSnap = {
  ${theInitValues[0]}
} as ${routeCName}Partial;


let snap = $state<${routeCName}Partial>(data.locals.${routeName_} as ${routeCName}Partial ?? nullSnap);
const snap_ = () => {
  return snap;
};
let selected${routeCName}Id = $state(
  data.locals.${routeName_}.id
);
const selected${routeCName}Id_ = () => {
  return selected${routeCName}Id;
};

$effect(() => {
    const sel${routeCName}Id = selected${routeCName}Id_();
    if (sel${routeCName}Id && data.${routeName_}s) {
      const u = data.${routeName_}s.filter(
        (${routeName_}) => ${routeName_}.id === sel${routeCName}Id,
      )[0]; // as ${routeCName}Partial;
      if (u) {
        snap = {
          ${theInitValues[2]}
        };
      }
    }
  });
let loading = $state<boolean>(false); // toggling the spinner
let btnCreate: HTMLButtonElement;
let btnUpdate: HTMLButtonElement;
let btnDelete: HTMLButtonElement;
let iconDelete: HTMLSpanElement;
let result = $state('');
const clearMessage = () => {
  setTimeout(() => {
    result = '';
  }, 2000);
};
    
const capitalize = (str:string) => {
  const spaceUpper = (su:string) => {
    return \` \${su[1]?.toUpperCase()}\`
  }
        
  return str
  .replace(/(_\\w)/, spaceUpper)
  .replace(/\\b[a-z](?=[a-z]{2})/g, (char) => char.toUpperCase())
}
    
let formDataValid = $derived.by(() => {
  if (!snap_()) return false;
    for (const [key, value] of Object.entries(snap_())) {
      if (key === 'id') continue;
      if (!value) return false;
    }
    return true;
});
    
const clearForm = (event?: MouseEvent | KeyboardEvent) => {
  event?.preventDefault();
  snap = nullSnap;
  utils.hideButtonsExceptFirst([btnCreate, btnUpdate, btnDelete]);
};
  
const enhanceSubmit: SubmitFunction = async ({ action, formData }) => {
  const required:string[] = [];
  for (const [key, value] of Object.entries(snap)) {
    formData.set(key, value as string);
    if(!value){
      const req = key +' is required';
      const el = document.querySelector('[title="' + key +'"]')
      if (el){
        (el as HTMLInputElement).placeholder += req;
        required.push(req)
      }
    }
  }  
        
  if (required.join('').length){
    return;
  }
  loading = true; // start spinner animation
    
  result =
    action.search === '?/create'
    ? "creating ${routeName_}..."
    : action.search === '?/update'
    ? "updating ${routeName_}..."
    : "deleting ${routeName_}..."
  if (action.search === '?/delete') {
    utils.hideButtonsExceptFirst([btnDelete, btnCreate, btnUpdate]);
  }
    
  return async ({ update }) => {
    await update();
      
    if (action.search === '?/create') {
      result = page.status === 200 ? "${routeName_} created" : 'create failed';
    } else if (action.search === '?/update') {
      result = page.status === 200 ? "${routeName_} updated" : 'update failed';
    } else if (action.search === '?/delete') {
      result = page.status === 200 ? "${routeName_} deleted" : 'delete failed';
      // iconDelete.classList.toggle('hidden');
      utils.hideButtonsExceptFirst([btnCreate, btnUpdate, btnDelete]);
    }
    invalidateAll();
    await utils.sleep(1000);
    loading = false; // stop spinner animation
    clearForm();
    utils.hideButtonsExceptFirst([btnCreate, btnUpdate, btnDelete]);
    clearMessage();
  }

      ${buttons_()}
  }
  let owner = true;
  const toggleColor = (event: MouseEvent, caption?: string) => {
  console.log('caption', caption)
  const grand = (event.target as HTMLSpanElement)?.parentElement?.parentElement;
  
  const style = grand?.parentElement?.style;
  if (style){
    style.color = style.color === 'red' ? 'blue' : 'red';
  }
};
</script>
<svelte:head>
  <title>${routeName_} Page</title>
</svelte:head>
${cr_Activity}

<form action="?/create" method="post" use:enhance={enhanceSubmit}>
  <div class='form-wrapper'>
    ${inputBoxes}
    <div class='buttons-row'>
      ${buttons}<button onclick={clearForm}>clear form</button>
      </div>
    </div>
  </div>
</form>
<div style="border:0;padding:0; color:green;">
  This is a list item to be deleted{@render iconHandler(
    true,
    'delete item',
    'fa fa-trash',
  )}
</div>
<div style="border:0;padding:0; color:green;">
  This is a list item to be deleted by not owner{@render iconHandler(
    false,
    'delete item',
    'fa fa-trash',
  )}
</div>
<div style="border:0;padding:0; color:blue;">
  This is a list item for toggling color{@render iconHandler(
    true,
    'toggle color',
    'fa-duotone fa-solid fa-paint-roller',
    (event: MouseEvent) => toggleColor(event, 'toggle color'),
  )}
</div>

{#snippet iconHandler(
  owner: boolean,
  caption: string,
  iconClass: string,
  clickHandler?: Function | undefined,
)}
  {#if owner}
    <CRTooltip {caption}>
      <span
        onclick={clickHandler
          ? (event: MouseEvent) => clickHandler(event, caption)
          : (event: MouseEvent) =>
              // @ts-expect-error
              event.target.parentElement?.parentElement?.parentElement.remove()}
        aria-hidden={true}
        style:cursor={owner ? 'pointer' : 'not-allowed'}
        style="margin=0 0.5rem;font-size:20px;color:cornsilk;border:1px solid gray;border-radius:4px;padding:2px 6px;"
      >
        <i class={iconClass}></i>
      </span>
    </CRTooltip>
  {:else}
    <CRTooltip caption="no owner permission">
      <span
        style:cursor={owner ? 'pointer' : 'not-allowed'}
        style="margin=0 0.5rem;font-size:20px;color:#c3909b;border:1px solid gray;border-radius:4px;padding:2px 6px;"
      >
        <i class={iconClass}></i>
      </span>
    </CRTooltip>
  {/if}
{/snippet}
<pre>How to use an Font Awesome iconHandler -- a child of a parent
It is rendered as @render iconHandler(boolean, caption, faIconClass, clickHandler?)
The fist argument when true allows action to be carried on, otherwise
it shows a 'not-allowed pointer' with tooltip 'no owner permission'.
The caption argument is a tooltip text displayed with delay when icon is hovering.
The faIconClass is the class name copied from an https://fontawesome.com/ page when
searching for an icon and extracting className from icon <i class="className"
  ></i>.
A clickHandler is an optional function reference to be called when icon is
clicked. As the icon is deeply buried in CRTooltip and span elements the user's 
clickHandler, which gets mouse event, should access its grandParent wrapper as
const parent = (event.target as HTMLSpanElement)?.parentElement.parentElement;
There are three examples above two to delete the parent with owner and not owner
and the third to toggle parent's color. 
</pre>

<style lang='scss'>
  .form-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    width: max-content;
    padding: 1rem;
    margin: 5rem auto;
    border: 0.3px solid gray;
    border-radius: 8px;
    .buttons {
      display: flex;
      gap: 0.3rem;
      justify-content: flex-end;
      align-items: center;
      button {
        display: inline-block;
      }
    }
  }
  .icon-delete{
    display: inline-block;
    width: max-content;
    padding: 3px 8px;
    border: 1px solid gray;
    border-radius: 4px;
  }
  .pink{
    color: pink;
  }
  CRTooltip:has(> span) {
    display: flex;
    align-items: baseline;
  }
</style>
`
  // outputChannel.appendLine('+page.svelte'+ plusPageSvelte); outputChannel.show();
  const pageSveltePath = path.join(routeNamePath, '/+page.svelte');
  outputChannel.appendLine('save +page.svelte at '+ pageSveltePath); outputChannel.show();
  fs.writeFileSync(pageSveltePath, plusPageSvelte, 'utf8');
}
// function createUtils(routeName:String, fields:string[]) {
  
//   const utils = `export const sleep = async (ms: number) => {
  //     return new Promise((resolve) => {
    //       setTimeout(() => {
      //         // ms here is a dummy but required by
      //         // resolve to send out some value
//         resolve(ms)
//       }, ms)
//     })
//   }
  
//   export const resetButtons = (buttons: HTMLButtonElement[]) => {
//     try {
//       buttons.forEach((btn) => {
//         btn.classList.remove('hidden')
//         btn.classList.add('hidden')
//         try {
//           btn.hidden = true
//         } finally {
//         }
//       })
//     } catch { }
//   }
// `;

//   const utilsPath = path.join(rootPath as string, '/src/lib/utils');
//   if (!fs.existsSync(utilsPath)) {
//     fs.mkdirSync(utilsPath, { recursive: true });
//   }
//   let filePath = path.join(utilsPath, 'crHelpers.ts')
//   fs.writeFileSync(filePath, utils, 'utf8');

//   const content = "export * from '/home/mili/TEST/cr-crud-extension/src/lib/utils/crHelpers';";
//   filePath = path.join(utilsPath, 'index.ts');
//   if (!fs.existsSync(filePath)){
//     fs.writeFileSync(filePath, content, 'utf8');
//   } else {
//     // check if crHelpers are exported from /utils/index.ts
//     const exports = fs.readFileSync(filePath, 'utf8');
//     if (!exports.includes('crHelpers')){
//       fs.appendFileSync(filePath, content, 'utf8');
//     }
//   }
// }

function createCRInput(){
  const componentsPath = ensureComponentPath()
  if (!componentsPath) return
  const crInput = `<script lang="ts">
  //  components/RInput.svelte
  import { browser } from '$app/environment';
  import * as utils from '$lib/utils';
  import { onMount } from 'svelte';
  type TExportValueOn =
    | 'keypress'
    | 'keypress|blur'
    | 'enter'
    | 'blur'
    | 'enter|blur';

  type PROPS = {
    title: string;
    width?: string;
    height?: string;
    fontsize?: string;
    margin?: string;
    type?: string|number|Date|boolean|password|time|text|tel|range|radio|checkbox;
    value?: string;
    required?: boolean;
    capitalize?: boolean;
    err?: string[] | undefined;
    onButtonNext?: () => void;
    exportValueOn?: TExportValueOn;
    onInputIsReadyCallback?: () => void; // call parent when onInputIsReadyCallback for 'enter', otherwise on every key
    clearOnInputIsReady?: boolean; // clear input value on onInputIsReadyCallback
  };

  let {
    title,
    width = '16rem',
    height = '2.5rem',
    fontsize = '16px',
    margin = '0',
    type,
    value = $bindable(),
    required = false,
    err = undefined,
    onButtonNext,
    exportValueOn = 'enter',
    onInputIsReadyCallback = undefined,
    capitalize = false,
    clearOnInputIsReady = false,
  }: PROPS = $props();

  export const capitalizes = (str: string) => {
    const spaceUpper = (su: string) => {
      // getting _string so return ' String' with a leading space
      return \` \${su[1]?.toUpperCase()}\`;
    };
    str = str[0]?.toUpperCase() + str.slice(1);
    return (
      str
        .replace(/\b[a-z](?=[a-z]{2})/g, (char) => char.toUpperCase())
        // snake_string_format replace _ with space
        .replace(/(_\w)/, spaceUpper)
    );
  };

  // @ts-expect-error
  String.prototype.capitalizes = function () {
    return capitalizes(this as string);
  };
  // NOTE: enter non breaking unicode space: type 00A0 and press Alt + X
  // here we held between apostrophes three non breaking spaces
  title = '   ' + capitalizes(title);
  let requiredStr = required ? \`\${title} is required\` : '';

  (function () {
    // IIFE
    exportValueOn = exportValueOn.toLowerCase() as TExportValueOn;
    // make combination be with 'enter|blur' and 'keypress|blur' if inverted
    const parts = exportValueOn.split('|');
    if (parts.length > 1 && parts[0] === 'blur') {
      exportValueOn = \`\${parts[1]}|\${parts[0]}\` as TExportValueOn;
    }
  })();
  const topPosition = \`\${-1 * Math.floor(parseInt(fontsize) / 3)}px\`;

  // allow pre-defined values to show up when user specify them
  // let inputValue = $state<string>('');

  if (browser) {
    try {
      utils.setCSSValue('--INPUT-BOX-LABEL-TOP-POS', topPosition);
      if (width) utils.setCSSValue('--INPUT-COMRUNNER-WIDTH', width as string);
      if (height)
        utils.setCSSValue('--INPUT-COMRUNNER-HEIGHT', height as string);
      if (fontsize)
        utils.setCSSValue('--INPUT-COMRUNNER-FONT-SIZE', fontsize as string);
      width = utils.getCSSValue('--INPUT-COMRUNNER-WIDTH') as string;
    } catch (err) {
      console.log('<InputBox get/setCSSValue', err);
    }
  }

  const onFocusHandler = (event: FocusEvent) => {
    event.preventDefault();
    labelStyle = 'opacity:1;top:3px;';
  };

  const onBlurHandler = (event: FocusEvent) => {
    event.preventDefault();

    // no entry yet so no export is ready buy is dirty -- only handle placeholder if entry is required
    if (value === '') {
      // input is required so warn the user with pink placeholder required message
      if (required) {
        inputEl.placeholder = requiredStr;
        labelStyle = 'opacity:1; top:3px;';
        utils.setPlaceholderColor('pink');
      } else {
        // input is not required so lower down field label inside the input box
        labelStyle = 'opacity:0.5;25px';
      }
    }
    if (exportValueOn.includes('blur')) {
      // value = inputValue;
      if (onInputIsReadyCallback) {
        onInputIsReadyCallback();
      }
    }
  };
  const onKeyUpHandler = (event: KeyboardEvent) => {
    event.preventDefault();
    if (event.key === 'Tab') return;
    if (capitalize && value) {
      // NOTE: reactive variable inputbox value does not updates
      // inputbox value when changed via script, so inputEl.value
      // as a workaround is updated instead
      inputEl.value = utils.capitalize(value);
    }
    // if keypress is Enter and exportValueOn does not include Enter we return
    if (exportValueOn.includes('enter') && event.key !== 'Enter') {
      if (capitalize && value) {
        // value = capitalizes(value);
        value = utils.capitalize(value);
      }
      return;
    }
    // already prevented blur|keypress and blur|enter
    // blur always follows if any case
    if (!'keypress|blur|enter|blur'.includes(exportValueOn) && value) {
      value = capitalizes(value);
      return;
    }
    if (value && value.length > 0) {
      if (capitalize) {
        value = capitalizes(value);
      }

      // if input should be returned
      // (blur is handled in a separate onBlurHandler)
      if (
        exportValueOn.includes('keypress') ||
        (exportValueOn.includes('enter') && event.key === 'Enter')
      ) {
        // value = inputValue;

        if (onInputIsReadyCallback) {
          onInputIsReadyCallback();
          if (clearOnInputIsReady) {
            value = '';
          }
        }
      }
    }
  };

  // input box has a label text instead of a placeholder in order to
  // move it up on focus, but the text does not set focus on input
  // element on click -- so we have to set the focus when the label
  // text is selected
  let labelStyle = $state('opacity:0.5;top:25px;');
  let label: HTMLLabelElement;
  let inputEl: HTMLInputElement;
  export const setFocus = () => {
    inputEl.focus();
  };

  // parent call to set input box value
  export const setInputBoxValue = (str: string, blur: boolean = false) => {
    if (blur) {
      setTimeout(() => {
        inputEl.blur();
      }, 1000);
    }
    inputEl.focus();
    value = str;
  };
  // setContext('setInputBoxValue', setInputBoxValue);
  onMount(() => {
    label = document.getElementsByTagName('label')[0] as HTMLLabelElement;
    setTimeout(() => {
      if (value && inputEl) {
        setFocus();
      }
    }, 300);
  });
</script>

<div class="input-wrapper" style="margin:{margin};">
  <input
    id="inp"
    bind:this={inputEl}
    type={type ? type : 'text'}
    required
    bind:value
    onkeyup={onKeyUpHandler}
    onfocus={onFocusHandler}
    onblur={onBlurHandler}
    disabled={false}
  />
  <label
    for="inp"
    onclick={setFocus}
    aria-hidden={true}
    style={\`\${labelStyle}\`}
  >
    {title}
    <span class="err">
      {err ? \` - \${err}\` : ''}
    </span>
  </label>
</div>

<style lang="scss">
  :root {
    --INPUT-COMRUNNER-WIDTH: 16rem;
    --INPUT-BOX-LABEL-TOP-POS: -1px;
    --INPUT-COMRUNNER-HEIGHT: 2.5rem;
    --INPUT-COMRUNNER-FONT-SIZE: 16px;
  }

  .input-wrapper {
    position: relative;
    width: max-content;
    /* adjust label to look like placeholder */
    padding-top: 0.8rem;
    label {
      position: absolute;
      // transform: translateY(-50%);
      // top: calc(var(--INPUT-COMRUNNER-HEIGHT) * 0.5);
      left: 15px;
      // top: 26px;
      font-size: var(--INPUT-COMRUNNER-FONT-SIZE);
      color: var(--INPUT-COLOR);
      background-color: var(--INPUT-BACKGROUND-COLOR);
      // opacity: 0.5;
      transition: 0.5s;
      // .stay-on-top {
      //   top: -15px;
      // }
    }
    input {
      display: inline-block;
      width: var(--INPUT-COMRUNNER-WIDTH);
      height: var(--INPUT-COMRUNNER-HEIGHT);
      font-size: var(--INPUT-COMRUNNER-FONT-SIZE);
      padding: 0 10px;
      margin: 0;
      color: var(--TEXT-COLOR);
      &:focus {
        color: var(--INPUT-FOCUS-COLOR);
      }
      &:focus ~ label,
      &:valid ~ label {
        top: var(--INPUT-BOX-LABEL-TOP-POS);
        font-size: var(--INPUT-COMRUNNER-FONT-SIZE);
        opacity: 1;
      }
    }
  }

  .err {
    color: pink;
    // border: 1px solid #808080;
    // border-radius: 3px;
    padding: 1px 0.5rem;
  }
</style>
`
  const crInputPath = path.join(componentsPath, 'CRInput.svelte')
  fs.writeFileSync(crInputPath, crInput, 'utf8');
}

function createCRSpinner(){
  const componentsPath = ensureComponentPath()
  if (!componentsPath) return
  const crSpinner = `<!--
@component
	CRSpinner wraps an HTMLButtonElement named button, so it could be bound to a parent variable say
    let btnCreate:HTMLButtonElement
  <CRSpinner bind:button={btnCreate} ...><CRSpinner>
  and it is the only way to get reference to the embedded button.
  There is no way for now to get reference via document.querySelector('CRSpinner')
  or document.getElementsByTagName('CRSpinner')[0]

	CRSpinner component features a 3/4 circle skyblue spinner. In order to start and stop spinning its spinOn
	property should be bound to a parent boolean variable, e.g. let loading:boolean = false (not a $state rune)
	Spin starts when loading is set to true and stops when it is false
	Mandatory props are 
		- caption     -- a button title
    - spinOn      -- boolean controlling spin on/off  with loading true/false
    - button      -- a parent variable bound to internal CRSpinner button via parent code like
										import CRSpinner from '$lib/components/CRSpinner.svelte'
										let btnCreate:HTMLButtonElement
										let cursor:boolean           -- true set it to 'pointer', false to 'not allowed'
										let loading:boolean = false  -- keep spinner idle until loading = true
										let hidden:boolean = true    -- hidden until conditionally visible, 
																										false for initially visible buttons like Create Todo
																										All buttons should be visible only when applicable
										Property formaction is defined for SvelteKIt enhance with URL actions like
										'?/createTodo', '?/updateTodo', '?'deleteTodo'. '?/toggleTodoCompleted',...
										so formaction='?/createTodo' would submit form data to action in +page.server.ts
										export const actions: Actions = {
										createTodo: async ({ request }) => { ...
										Property cursor is optional and is used to warn user for action not allowed
										<CRSpinner 
												bind:button={btnCreate} 
												caption='Create Todo' 
												spinOn={loading}
												hidden={hidden}
												/* optional */
												cursor={cursor}   		/* default is true (pointer) false for 'not allowed'
												width='6rem'      		/* max-content + padding='4px 1.5rem  -- default, */
																							/* or other values iin units like px */
												height='2rem'     		/* default, but could be specified in values of other units e,g, px */
												top='0'				    		/* adjust position:absolute of spinner to get along with button's hight */
												color='skyblue'   		/= but could be rgba, hsa or #xxxxxx forma as well */
												spinnerSize='1.3rem'	/* spinner circle diameter, default is 1em but could be different */
											  duration='3s'     		/* duration in seconds for one RPM, default is 1.5s */
										>
										</CRSpinner>
-->
<script lang="ts">
  // components/CRSpinner.svelte
  export type TButtonSpinner = HTMLButtonElement & CRSpinner;

  type TProps = {
    caption: string;
    button: HTMLButtonElement;
    spinOn: boolean;
    formaction?: string;
    hidden?: boolean;
    disabled?: boolean;
    cursor?: boolean;
    color?: string;
    duration?: string;
    spinnerSize?: string;
    top?: string;
    width?: string;
    height?: string;
  };
  let {
    caption = 'button',
    button = $bindable(),
    formaction,
    spinOn,
    hidden = $bindable(true),
    disabled = $bindable(false),
    cursor = $bindable(true),
    color = \`skyblue\`,
    duration = \`1.5s\`,
    spinnerSize = \`1em\`,
    top = \`0\`,
    width = 'max-content',
    height = '2rem',
  }: TProps = $props();
</script>

{#snippet spinner(color: string)}
  <!-- styling for a spinner itself -->
  <div
    class="spinner"
    style:border-color="{color} transparent {color}
    {color}"
    style="--duration: {duration}"
    style:text-wrap="nowrap !important"
    style:width={spinnerSize}
    style:height={spinnerSize}
    style:top={Number(height) / 2}
  ></div>
{/snippet}

<p style="position:relative;margin:0;padding:0;display:inline-block;">
  <!-- styling for an embedded button -->
  <button
    bind:this={button}
    type="submit"
    class:hidden
    {formaction}
    {disabled}
    style:cursor={cursor ? 'pointer' : 'not-allowed'}
    style:width
    style:height
    style:top={Number(height) / 2}
    style:padding="4px 1.5rem"
  >
    {#if spinOn}
      <!-- NOTE: must have ancestor with position relative to get proper position -->
      {@render spinner(color)}
    {/if}
    {caption}
  </button>
</p>

<style>
  .spinner {
    position: absolute;
    display: inline-block;
    vertical-align: middle;
    margin: 0 4pt;
    border-width: calc(1em / 4);
    border-style: solid;
    border-radius: 50%;
    animation: var(--duration) infinite rotate;
    position: absolute;
    left: 0;
    /* top: 0.5rem !important; */
  }
  @keyframes rotate {
    100% {
      transform: rotate(360deg);
    }
  }
  .hidden {
    display: none;
  }
  button {
    display: inline-block;
  }
</style>
`
  const crSpinnerPath = path.join(componentsPath, 'CRSpinner.svelte')
  fs.writeFileSync(crSpinnerPath, crSpinner, 'utf8');
}

function createCRActivity(){
  const componentsPath = ensureComponentPath()
  if (!componentsPath) return
  const crActivity = `<script lang="ts">
	// CRActivity
  import { onMount } from 'svelte';
  import * as utils from '$lib/utils';
  import '/src/app.d';
  type ARGS = {
    PageName: string;
    result: string;
    selectedUserId: string;
    user: UserPartial;
    users: UserPartial[] | [];
  };
  let {
    PageName,
    result = $bindable(),
    selectedUserId = $bindable(),
    user,
    users,
  }: ARGS = $props();

  if (users?.length === 0) {
    users[0] = user as UserPartial;
  }
  const selectedUserId_ = () => {
    return selectedUserId;
  };

  const getSelectedUserRole = () => {
    if (!users) return '';
    return users.filter((user) => user.id === selectedUserId)[0]?.role as Role;
  };
  // svelte-ignore non_reactive_update
  // let msgEl: HTMLSpanElement;
  // svelte-ignore non_reactive_update
  let selectBox: HTMLSelectElement;
  let timer: NodeJS.Timeout | string | number | undefined; //ReturnValue<typeof setTimeout>;
  const killTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  const scheduleClearMessage = () => {
    killTimer();
    timer = setTimeout(() => {
      result = '';
      if (msgEl) {
        msgEl.innerText = '';
      }
    }, 2000);
  };
  const showResult = () => {
    scheduleClearMessage();
    return result;
  };
  let [userName, role] = $derived.by(() => {
    let user = users?.filter((u) => u.id === selectedUserId)[0] as UserPartial;
    if (user) {
      return [\`\${user?.firstName} \${user?.lastName}\`, user.role];
    } else {
      return ['not available', 'VISITOR'];
    }
  });

  onMount(() => {
    selectedUserId = user.id as string;
  });
</script>

<svelte:head>
  <title>{utils.capitalize(PageName)}</title>
</svelte:head>
<div class="activity">
  <span style="color:gray;font-size:24px;"
    >{utils.capitalize(PageName)} Page</span
  >
  {#if user?.role === 'ADMIN' && users.length > 1}
    <select bind:this={selectBox} bind:value={selectedUserId}>
      {#each users as the_user}
        <option value={the_user.id}>
          {the_user.firstName}
          {the_user.lastName}
        </option>
      {/each}
    </select>
    <span style="font-size:11px;padding:0;margin:0;"
      >{getSelectedUserRole()}</span
    >
    <span class="user_name"
      >(logged-in {user?.firstName}
      {user?.lastName}--<span style="font-size:11px;">{user?.role})</span></span
    >
  {/if}
  <!-- <span class="user-name"
    >{userName} <span style="font-size:11px;">{user?.role}</span></span
  > -->
  {#key result}
    {#if result !== ''}
      <span bind:this={msgEl} class="message">{showResult()}</span>
    {/if}
  {/key}
</div>

<style lang="scss">
  .activity {
    display: flex;
    gap: 1rem;
    align-items: baseline;
    margin-left: 1rem;
    .message,
    .user-name,
    .user_name {
      display: inline-block;
      font-size: 14px;
      font-weight: 100;
      color: lightgreen;
      margin-left: 1rem;
    }
    .user_name {
      color: skyblue;
    }
  }
  select {
    margin-right: -0.7rem !important;
    padding: 1px 1rem;
    margin: 0;
    font-size: 14px;
    line-height: 14px;
  }
</style>
`

  const crActivityPath = path.join(componentsPath, 'CRActivity.svelte')
  fs.writeFileSync(crActivityPath, crActivity, 'utf8');
}

function createCRTooltip(){
  const componentsPath = ensureComponentPath()
  if (!componentsPath) return
  const crTooltip = `<!-- 
@component
CRTooltip could accept the following props, though all are optional
  type TProps = {
    delay?: number;                 // transform params delay duration and baseScale
    duration?: number;
    baseScale?: number;

    caption?: string;               // caption, a string, and panel snippet are mutually exclusive.
                                    // The caption string can be styled by CSS style string or a class name
                                    // sent as captionCSS prop. When both panel and caption are specified 
                                    // inside the props the caption string is ignored

    captionCSS?: string;            // user styling as a CSS class name or a style string applied e.g. captionCSS='caption-class'
                                    // with :global(.caption-class){...} or with a style captionCSS='font-size:14px; color:orange;'
                                    // CRTooltip has a default caption CSS class .caption-default that can be overridden
                                    // by sending a class name or style string via captionCSS prop.

                                    // When the parent page have several hovering elements that uses the same styling avoid
                                    // repeating <Tooltip captionCSS="caption-class" ...> for each hovering element
                                    // but define var props structure that includes several common props along with caption-class
                                    // and spread it via {...props} inside <Tooltip {...props} ...> for each
                                    // hovering element that uses the same styling

    panel?: TPanel;          // A snippet object defined by parent page and sent as object name to a component via $props().
                                    // If caption and panel snippet name are both specified the caption is ignored
                                    // e.g. for {#snippet userDetails(user)} we specify $props()
                                    // panel={userDetails}   -- a function reference, not as a string panel="userDetails"
    panelArgs?: TPanelArgs;         // When panel accepts arguments the parent page sends to the Tooltip component panelArgs prop
                                    // as an array of arguments to be forwarded to the panel snippet
                                    // For instance for userDetails snippet defined as
                                    //      {#snippet userDetails([fName, lName, isAdmin]: [string, string, boolean])}
                                    // where args are sent as a tuple (an array of fixed length with item types)
                                    // the parent page sends panelArgs={['John:', 'Doe', true]} to the Tooltip component
                                    // and the Tooltip component forwards it to the userDetails snippet when rendering it
                                    //      {@render runtimePanel?.(panelArgs)} 

    children?: Snippet;             // Any HTML markup content between <Tooltip> children... </Tooltip> tags.
                                    // Children is a hovering element triggering tooltip visibility via mouseenter/mouseleave
                                    // so children HTML markup is usually encapsulated in a single HTML hovering element

    preferredPos?: string;          // When, due to scrolling, there is a lack of space around the hovering element CRTooltip
                                    // tries to find an available space following the recommended sequence by the preferredPos
                                    // prop string or, if not specified, by the default one 'top,left,right,bottom'
    
    toolbarHeight?: number          // If a page has a toolbar in layout its height would impact calculation of the proper
                                    // tooltip top position required by preferredPos, so its height should be sent via props.
                                    // Not only toolbar but the other styling including layout and styling of children block
                                    // defined in layout. So try to find the exact value otherwise tooltip in the top position
                                    // could be clipped on its top part 

  };

-->

<script lang="ts">
  //  components/CRTooltip.svelte
  import { type Snippet, onMount } from 'svelte';
  import { cubicInOut } from 'svelte/easing'; // for animated transition
  import type { EasingFunction } from 'svelte/transition';

  // fade scale animation for displaying/hiding tooltip
  export interface FadeScaleParams {
    delay?: number;
    duration?: number;
    easing?: EasingFunction;
    baseScale?: number;
    translateX?: string;
    translateY?: string;
  }

  const fadeScale = <IProps extends FadeScaleParams>(
    node: HTMLElement,
    {
      delay = 100,
      duration = 1600,
      easing = (x: number) => x,
      baseScale = 0,
      translateX = '1rem',
      translateY = '-160%',
    }: IProps,
  ) => {
    const opacity = +getComputedStyle(node).opacity;
    const m = getComputedStyle(node).transform.match(/scale\(([0-9.]+)\)/);
    const scale = m ? Number(m[1]) : 1;
    const is = 1 - baseScale;
    // transform: translate uses matrix's last two entries for translate x and y
    // with scaleX=1 skewX=0 skewY=0  scaleY=1 (1-no scale and 0-no skew) just translate
    // NOTE: transform: translate is defined in the Tooltip.svelte and must specify
    // the same left/top values as the one in this css return value
    return {
      delay,
      duration,
      css: (t: number) => {
        const eased = easing(t);
        return \`opacity: \${eased * opacity}; transform: translate(\${translateX},\${translateY}) scale(\${eased * scale * is + baseScale}) \`;
      },
    };
  };

  const sixHash = () => {
    const a = (Math.random() * 46656) | 0;
    const b = (Math.random() * 46656) | 0;
    return a.toString(36).slice(-3) + b.toString(36).slice(-3);
  };

  const hoveringId = 'hovering-' + sixHash();
  // as caption and panel are mutually exclusive
  // even when both are received via $props()
  // we use the same tooltipPanelId for both
  // const tooltipPanelId = 'tooltip-' + sixHash();
  let tooltipPanelEl = $state<HTMLElement | null>(null);
  const round = Math.round;

  type TPanelArgs = any[];
  type TPanel = Snippet<[...any[]]> | null;
  type TProps = {
    delay?: number;
    duration?: number;
    baseScale?: number;
    caption?: string;
    captionCSS?: string;
    panel?: Snippet<[...any[]]> | null;
    panelArgs?: TPanelArgs; // arguments to forward
    children?: Snippet;
    preferredPos?: string;
    toolbarHeight?: number;
  };

  let {
    duration = 1000,
    delay = 800,
    baseScale = 0,
    caption = '',
    captionCSS = '',
    panel,
    panelArgs, // arguments to forward
    children,
    preferredPos = 'top,left,right,bottom',
    toolbarHeight = 0,
  }: TProps = $props();

  // Need to define variables as the setTooltipPos function adjusted them
  // to position properly based on preferredPos settings and available
  // space around the hovering element
  let translateX = $state<string>('');
  let translateY = $state<string>('');

  let runtimePanel: TPanel = panel ? panel : caption ? captionPanel : null;

  if (!runtimePanel) {
    throw new Error('panel or caption is mandatory');
  }

  const getPreferred = () => {
    return preferredPos.replace(/\s+/g, '').split(',') as string[];
  };

  let visible = $state(false);
  let initial = $state(true);

  // the setTooltipPos examine necessary parameters for applying
  // tooltip at required position and is forced to iterate over
  // the preferredPos list until params for a position match
  const OK = $state({
    top: false,
    bottom: false,
    leftRightBottom: false,
    topBottomRight: false,
    left: false,
    right: false,
  });

  // the setTooltipPos is triggered via mouseenter and has to have
  // rectangles for hovering element and its accompanying tooltip
  // to move tooltip to the proper space. The HoverData is bound
  // to accompanying hovering element via its id set by this
  // component initially in onMount and is saved in a Record list
  type HoverData = {
    hoverRect: DOMRect;
    tooltipRect: DOMRect;
  };
  // Record is an array type of a given key type and value type
  // where  key is a hovering element id inserted inside onMount
  // and registered in hoverRec array easy to fetch it when
  // onmouseenter handler has to display tooltip in a required
  // preferredPos position
  type HoverRecord = Record<string, HoverData>;
  const hoverRec: HoverRecord = {};

  const addRecord = (key: string, hr: DOMRect, tr: DOMRect) => {
    hoverRec[key] = { hoverRect: hr, tooltipRect: tr };
  };

  // triggered via mouseenter of the hovering elements to set its
  // accompanying tooltip in requiredPos position
  const setTooltipPos = (hoveringElement: HTMLElement) => {
    // NOTE: If your app has a Toolbar its height should be included in calculation.
    // For svelte-postgres app the toolbar height is 32px

    const { hoverRect, tooltipRect } = hoverRec[
      hoveringElement.id
    ] as HoverData;
    if (!hoverRect || !tooltipRect) {
      return;
    }

    translateX = '';

    // is there enough space at the right side of the screen for width and for height
    OK.topBottomRight =
      hoverRect.left - window.scrollX + tooltipRect.width < window.innerWidth;

    // is there enough space before the bottom side of the screen
    OK.leftRightBottom =
      hoverRect.top - window.scrollY + tooltipRect.height < window.innerHeight;

    OK.top =
      hoverRect.top - window.scrollY - toolbarHeight > tooltipRect.height;

    OK.bottom =
      hoverRect.bottom - window.scrollY + tooltipRect.height <
      window.innerHeight;

    OK.left = hoverRect.left - window.scrollX > tooltipRect.width;

    OK.right =
      hoverRect.right - window.scrollX + tooltipRect.width < window.innerWidth;


    for (let i = 0; i < getPreferred().length; i++) {
      const pref = getPreferred();
      switch (pref[i] as string) {
        case 'top':
          if (OK.top && OK.topBottomRight) {
            translateX = '0px';
            translateY = \`\${-tooltipRect.height}px\`;
          }
          break;
        case 'left':
          if (OK.left && OK.leftRightBottom) {
            translateX = \`\${-tooltipRect.width}px\`;
            translateY = '0px';
          }
          break;
        case 'right':
          if (OK.right && OK.leftRightBottom) {
            translateX = \`\${hoverRect.width}px\`;
            translateY = '0px';
          }
          break;
        case 'bottom':
          if (OK.bottom && OK.topBottomRight) {
            translateX = '0px';
            translateY = \`\${hoverRect.height + 5}px\`;
          }
          break;
        default:
          break;
      }
      // if available position is found turn the tooltip on and exit teh loop
      if (translateX !== '') {
        visible = true;
        break;
      }
    }
    // no available position was found so we improvise
    if (translateX === '') {
      translateY = OK.top
        ? \`\${-tooltipRect.height}px\`
        : \`\${hoverRect.height}px\`;
      translateX = OK.left
        ? \`\${window.innerWidth - (hoverRect.right - window.scrollX) - hoverRect.width}px\`
        : '0px';
      visible = true;
    }
  };

  const toggle = (event: MouseEvent) => {
    if (event.type === 'mouseenter') {
      setTooltipPos(event.currentTarget as HTMLElement);
    } else {
      visible = false;
    }
  };

  onMount(() => {
    setTimeout(() => {
      // tooltipPanelEl holds panel or captionPanel
      // depending on the $props() passed to this component
      // and we take the child as a runtimePanel
      // const ttPanelWrapper = document.getElementById(
      //   tooltipPanelId,
      // ) as HTMLElement;

      if (tooltipPanelEl) {
        // ttPanel is a panel or a captionPanel to be show as a tooltip
        const ttPanel = tooltipPanelEl.children[0] as HTMLElement;

        // hoveringEl is the element that triggers the tooltip
        // child wrapper children are hovering elements mouseenter/mouseleave
        const hoveringEl = document.getElementById(hoveringId) as HTMLElement;

        if (ttPanel && hoveringEl) {
          addRecord(
            hoveringId,
            hoveringEl.getBoundingClientRect() as DOMRect,
            ttPanel.getBoundingClientRect() as DOMRect,
          );
        }

        // Clean up after logging
        (tooltipPanelEl as HTMLElement).remove();
      }
    }, 0);

    window.addEventListener('scrollend', () => {
      translateX = '0px';
      translateY = '0px';
    });
  });
</script>

<!-- 
    NOTE: transform:translate is defined in the fade-scale and must specify
    the same left/top values as the one in this tooltipPanelEl handler

    On initial===true we find dimensions of tooltip panel wrapping it via 
    @render and then destroy wrapper after getting dimensions
-->
{#if initial}
  <div
    bind:this={tooltipPanelEl}
    style="\`position:absolute;top:-9999px !important;left:-9999px !important;visibility:hidden;padding:0;margin:0;border:none;outline:none;width:max-content;"
    class="ttWrapper"
  >
    {@render runtimePanel?.(panelArgs)}
  </div>
{/if}

{#snippet captionPanel(style?: string)}
  {#if captionCSS.includes(':')}
    <div
      bind:this={tooltipPanelEl}
      class="caption-default"
      style={captionCSS ?? ''}
    >
      {caption}
    </div>
  {:else}
    <div
      bind:this={tooltipPanelEl}
      class="caption-default {captionCSS}"
      style={style ??
        'padding:6px 0.5rem;margin:0 !important;height: 1rem !important;'}
    >
      {caption}
    </div>
  {/if}
{/snippet}

{#snippet handler()}
  {#if visible}
    <div
      id="ttWrapperId"
      style={\`position:absolute;  
      transform: translate(\${translateX},\${translateY});
      opacity: 0.85;
      padding: 0;
      margin:0;
      width:0;
      height:0;
      border:none;
      outline:none;
    \`}
      transition:fadeScale={{
        delay,
        duration,
        easing: cubicInOut,
        baseScale,
        translateX,
        translateY,
      }}
    >
      <div class="ttWrapper">
        {@render runtimePanel?.(panelArgs)}
      </div>
    </div>
  {/if}
{/snippet}

<div
  id={hoveringId}
  class="child-wrapper"
  onmouseenter={toggle}
  onmouseleave={toggle}
  aria-hidden={true}
>
  {@render handler()}
  {@render children?.()}
</div>

<style>
  .child-wrapper {
    display: inline-block;
    margin: 0;
    padding: 0;
    width: max-content;
    height: auto;
    border: none;
    outline: none;
    z-index: 10;
  }
  .ttWrapper {
    /* position: relative; */
    width: max-content;
    /*height: auto;*/
    margin: 0 !important;
    padding: 0 !important;
    border: none;
    outline: none;
  }
  .caption-default {
    border: 1px solid skyblue;
    border-radius: 5px;
    color: yellow;
    background-color: navy;
    width: max-content;
    padding: 3px 1rem;
    margin: 0;
    text-align: center;
    font-size: 14px;
    line-height:14px;
    font-family: Arial, Helvetica, sans-serif;
    z-index: 10;
  }
</style>
`

  const crTooltipPath = path.join(componentsPath, 'CRTooltip.svelte')
  fs.writeFileSync(crTooltipPath, crTooltip, 'utf8');
}
function createSummaryDetail(){
  const componentsPath = ensureComponentPath()
  if (!componentsPath) return
  const crSummaryDetail = `<script lang="ts">
  // components/CRSummaryDetails
  import { onMount } from 'svelte';
  type PROPS = {
    summary: string;
    details: string;
  };
  let { summary, details }: PROPS = $props();
</script>

<details>
  <summary> {summary} </summary>
  <pre>
  {details}
  </pre>
</details>

<style lang="scss">
  details * {
    margin: 0;
  }
  details {
    background-color: hsl(0 0% 25%);
    width: max-content;
    padding: 0.5rem 1rem;
    border-radius: 1rem;
    overflow: hidden;
  }
  details > pre {
    opacity: 0;
    /* margin up and down */
    padding-block: 1rem;
    margin-left: 1rem;
  }
  details[open] pre {
    animation: fadeIn 0.75s linear forwards;
  }
  pre {
    border: 1px solid hsl(0 0% 45%);
    border-radius: 10px;
    padding: 1rem;
    margin: 0.5rem 0 0 3rem !important;
  }
  @keyframes fadeIn {
    0% {
      opacity: 0;
    }
    100% {
      opacity: 1;
    }
  }
  summary {
    font-size: 1.5rem;
    color: hsl(0 0% 85%);
    background-color: hsl(0 0% 35%);
    margin-inline-start: 1rem;
    /* should be instead of margin-left in above details > p */
    list-style-position: outside;
    margin-left: 3rem;
    cursor: pointer;
    width: max-content;
    padding: 2px 3rem;
    border-radius: 8px;
  }
  summary::marker {
    color: hsl(0 0% 60%);
  }
</style>
`
  const crSummaryDetailPath = path.join(componentsPath, 'CRSummaryDetail.svelte')
  fs.writeFileSync(crSummaryDetailPath, crSummaryDetail, 'utf8');
}

async function findPrismaSchemaRoot(): Promise<string | null> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders?.length) {
    return null; // No workspace open
  }

  for (const folder of workspaceFolders) {
    let currentPath = folder.uri.fsPath;

    while (true) {
      const prismaSchemaPath = path.join(currentPath, "prisma", "schema.prisma");

      if (fs.existsSync(prismaSchemaPath)) {
        return currentPath; // ✅ Found root containing prisma/schema.prisma
      }

      if (currentPath === rootPath) {
        break; // reached project root, stop
      }
      // Walk up to parent folder
      const parentPath = path.dirname(currentPath);
      currentPath = parentPath;
    }
  }
    return null
  }

  function sortObjectKeys<T>(obj: Record<string, T>): Record<string, T> {
    return Object.fromEntries(
      /*
        "base" ignores case and diacritics (so User, user, Úser, üser all sort together).
        "accent" would keep diacritics (ú vs u) but ignore case.
        "case" would respect case but ignore accents.
        "variant" is the strictest (default) and respects everything.
        numeric sorts asc f10, f2 as f2 f10 -- not as the ascii's f10 f2
      */
      Object.entries(obj).sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }))
    );
  }

  // fieldInfo is a line following field names
  type FieldInfo = {
    type: string;
    prismaSetting: string; // everything after the type
  };

  // every model/table has fieldName  and fieldInfo
  type ModelInfo = {
    fields: {
      [fieldName: string]: FieldInfo;
    };
    modelAttributes: string[]; // e.g. ["@@map(\"users\")", "@@index([email])"]
  };

  // there are many models/tables in schema.prisma
  type SchemaModels = {
    [modelName: string]: ModelInfo;
  };

  
  let strModelNames = '|'

  function parsePrismaSchema(schemaContent: string): SchemaModels {
    const models: SchemaModels = {};
    const modelRegex = /model\s+(\w+)\s*{([^}]*)}/gms;

    let modelMatch;
    while ((modelMatch = modelRegex.exec(schemaContent)) !== null) {
    const [, modelName, body] = modelMatch;
    const fields: { [field: string]: FieldInfo } = {};
    const modelAttributes: string[] = [];

    // Remove block comments first
    let bodyWithoutBlocks = body.replace(/\/\*[\s\S]*?\*\//g, "");

    const lines = bodyWithoutBlocks
      .split("\n")
      .map((line) => line.trim().replace(/\s{2,}|\t/gm, ' '))
      .filter(Boolean);

    for (const line of lines) {
      if (line.startsWith("//")) continue; // skip single-line comment

      if (line.startsWith("@@")) {
        modelAttributes.push(line);
        continue;
      }

      const [fieldName, fieldType, ...rest] = line.split(/\s+/);
      if (!fieldName || !fieldType) continue;

      fields[fieldName] = {
        type: fieldType,
        prismaSetting: rest.join(" "),
      };
    }

    models[modelName] = {
      fields: sortObjectKeys(fields),
      modelAttributes,
    };
  }
  
  /* 
    This function returns models as SchemaModels so use it to populate above Models
    for data entry fields avoid fieldNames that are
    models itself like Todo, Profile, containing @@ chars 
    and some of @unique, @default, @default(now(), modelName), @relation
  */
  // make a string-list of modelNames like '|Todo|User|Profile|'
  for (const [modelName, theFields] of Object.entries(models)) {
    strModelNames += modelName +'|'
  }
  /*
    modelsFieldNames['User'] holds
    email: String 
    firstName: String 
    id: String 
    lastName: String 
    password: String 
    profile: Profile?         -- incorrect as model name
    role: Role 
    updatedAt: DateTime? 
    userAuthToken: String     -- incorrect @unique

  */
  for (const [modelName, theFields] of Object.entries(models)) {
    let arrFields = []
    const [, fields] = Object.entries(theFields)[0]
      for (let [fieldName, { type, prismaSetting }] of Object.entries(fields)) {
        if ('0|1'.includes(fieldName)) continue
        // type could be optional, so remove ? if any as it cannot match model name
        type = type.replace(/\?/g, '')
        if (fieldName.includes('password')){  // passwordHash or similar
          fieldName = 'password'
        }
        if (type=='DateTime'){
          type = 'Date';
        }
        // exclude this field names
        const pattern = '@default\\((' + strModelNames +'now\\(\\))\\)';
        let regex = new RegExp(pattern);
        let m = prismaSetting.match(regex);   // null if failed
        if(m && m[1]) continue;               // not data entry field name

        // type cannot be a model name like Profile...
        regex = new RegExp('('+ strModelNames.slice(1,-1) +')');
        m = type.match(regex);   // null if failed
        if (m && m[1]) continue

        m = prismaSetting.match(/(@unique|@createdAt)/);  // non-mutable
        if(m && m[1]) continue;

        const hasBrackets = type.includes('[]');
        const hasId = prismaSetting.includes('@id');
        const hasRole = type === 'Role';
        const include = !hasBrackets || hasId || hasRole;
        if (include){
          arrFields.push(fieldName + ': '+ type)
        }
    }
    try{
      modelsFieldNames[modelName] = arrFields;
    }catch(err){
      const msg = err instanceof Error ? err.message : String(err);
      console.log('cannot add a model'+ msg)
    }
  }

  return models;
}



export async function activate(context: vscode.ExtensionContext) {

  const workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined = vscode.workspace.workspaceFolders;
  // const defaultFolderPath: string = '/home/mili/TEST/cr-crud-extension';
  rootPath = await execShell('pwd');
  rootPath = rootPath.replace(/\n$/,'');
  routesPath = path.join(rootPath, '/src//routes/')
  // vscode.window.showInformationMessage('rootPath ' + rootPath)
  // vscode.window.showErrorMessage('execShell pwd '+ rootPath);

  // if (!workspaceFolders || workspaceFolders.length === 0) {
  //   // Check if default path exists
  //   if (fs.existsSync(defaultFolderPath)) {
  //     rootPath = defaultFolderPath;
  //   } else {
  //     // Fallback to dialog if default path is invalid
  //     const folderUri: vscode.Uri[] | undefined = await vscode.window.showOpenDialog({
  //       canSelectFolders: true,
  //       canSelectFiles: false,
  //       openLabel: 'Select workspace folder with Prisma/schema.prisma',
  //       defaultUri: vscode.Uri.file(defaultFolderPath)
  //     });
  //     if (!folderUri || folderUri.length === 0) {
  //       vscode.window.showErrorMessage('No workspace folder selected');
  //       return;
  //     }
  //     rootPath = folderUri[0].fsPath;
  //   }
  // } else {
  //   rootPath = workspaceFolders[0].uri.fsPath;
  // }
  // Create output channel for webview logs
  const outputChannel = vscode.window.createOutputChannel('WebView Logs');


  const prismaSchemaRoot = await findPrismaSchemaRoot();
  if (!prismaSchemaRoot){
    noPrismaSchema = true;
  }

  // let pendingFile = vscode.Uri.file(path.join(rootPath, '/prisma/installPartTwo.pending'));
  let pendingFile = path.join(rootPath, '/prisma/installPartTwo.pending');
  installPartTwoPending = fs.existsSync(pendingFile)
  // try {
  //   await vscode.workspace.fs.stat(pendingFile);
  //   installPartTwoPending = true;
  //   // File exists – proceed with Part Two logic
  // } finally {
  //   // File missing
  // }
  // vscode.debug.onDidStartDebugSession(session => {
  //   outputChannel.appendLine(`onDidStartDebugSession activated`);
  //   outputChannel.show(true);
  //   if (session.name === "Run Extension (with pak)") {
  //     vscode.commands.executeCommand("cr-crud-extension.createCrudSupport");
  //   }
  // });

  // context.subscriptions.push(
  //   vscode.debug.onDidStartDebugSession(session => {
  //     if (session.name === "Run Extension (with pak)") {
  //       vscode.commands.executeCommand("cr-crud-extension.createCrudSupport")
  //         .then(undefined, err => console.error("Failed to run CRUD support:", err));
  //     }
  //   })
  // );


  // register Create CRUD Support 
  const disposable = vscode.commands.registerCommand('cr-crud-extension.createCrudSupport', () => {
    
    // NOTE: To show workspaceFolders uncomment the lines below
    // const workspaceFolders = vscode.workspace.workspaceFolders;
    // outputChannel.appendLine(`workspaceFolders', ${JSON.stringify(workspaceFolders,null,2)}`)
    // outputChannel.show(true);

    const panel = vscode.window.createWebviewPanel(
      'crCrudSupport',
      'Create CRUD Form Support',
      vscode.ViewColumn.One,
      { enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    let includeTypes = ''
    if (noPrismaSchema){
      vscode.window.showInformationMessage('EXT: NO PRISMA SCHEMA FOUND');
    }
    // vscode.window.showInformationMessage('EXT: rootPath == '+ rootPath),
    // const nonce = getNonce();
    panel.webview.html = getWebviewContent(panel.webview, context.extensionUri, noPrismaSchema, installPartTwoPending);

    panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.command === 'installPrisma'){
        // vscode.window.showInformationMessage('Webview asked to install Prisma');
        const pm = detectPackageManager();
        if (typeof pm === 'object'){
          vscode.window.showInformationMessage('detectPackageManager err:'+ pm.err);
        }else{
          xPackageManager(pm);
        }
        // vscode.window.showInformationMessage('rootPath is '+ rootPath)
        sendToTerminal(`cd ${rootPath}`)
        sendToTerminal(`${pm} install typescript ts-node @types/node -D; ${pm} i -D prisma @prisma/client; ${ex} prisma init`);
        const prismaPath = path.join(rootPath, '/prisma/schema.prisma')
        for (let i=0; i < 30; i++){
          await sleep(2000)
          if (fs.existsSync(prismaPath)){
            break
          }
        }
        await sleep(2000);  // to be sure it is completed
        createPendingFile();
        
        panel.webview.postMessage({
          command: "installPartOneDone"
        });
        await sleep(2000)
        // panel.dispose()

        // read created /prisma/schema.prisma and display it in a new Tab
        try {
          // Get workspace root (assume first folder)
          const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
          if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder open');
            // TODO send to output how to make a Workspace
            return;
          }

          // Construct absolute file path
          const schemaPath = path.join(workspaceFolder.uri.fsPath, '/prisma/schema.prisma');
          if (!fs.existsSync(schemaPath)){
            fs.writeFileSync(schemaPath, '', 'utf8')
          }
            fs.appendFileSync(schemaPath, schemaWhatToDo, 'utf8');
            // Create path for the file
            let uri = vscode.Uri.file(schemaPath);
            // Open in a new tab (beside current editor)
            await vscode.window.showTextDocument(uri, { 
              viewColumn: vscode.ViewColumn.Beside, // Opens beside active editor
              preview: false // Optional: Force a new tab (not preview mode)
            });
            
            const envPath = path.join(rootPath, '/.env');
            uri = vscode.Uri.file(envPath);
            if (!fs.existsSync(envPath)){
              fs.writeFileSync(envPath, envWhatToDo, 'utf8')
            }
            await vscode.window.showTextDocument(uri, { 
                viewColumn: vscode.ViewColumn.Beside, // Opens beside active editor
                preview: false // Optional: Force a new tab (not preview mode)
            });

            // This does not work
            // // Save progress
            // context.workspaceState.update('installStep', 'installPartOneDone');

            // // Retrieve when focusing again
            // const step = context.workspaceState.get('installStep');
            // panel.webview.postMessage({ step });

            // panel.onDidChangeViewState(e => {
            //   // Retrieve when focusing again
            //   if (e.webviewPanel.active) {
            //     panel.webview.postMessage({ command: 'installPartOneDone' });
            //   }else{
            //     const step = context.workspaceState.get('installStep');
            //     panel.webview.postMessage({ command: 'installPartOneDone' });
            //   }
            // });
        } catch (error) {
            // Handle errors (e.g., file not found)
            console.error('Failed to open file:', error);
            panel.webview.postMessage({
                command: 'fileError',
                error: (error as Error).message
            });
        }



      }
      else if (msg.command === 'installPrismaPartTwo'){
        // vscode.window.showInformationMessage('Webview asked to install prisma part two');
        sendToTerminal(`${ex} prisma migrate dev --name init; ${ex} prisma generate`);
        await sleep(10000)
        // child_process.exec(command, (error, stdout, stderr) => {
        //   if(error){
        //     vscode.window.showInformationMessage('Installing PrismaPartTwo failed '+ error);
        //     return
        //   }
        // });
        deletePendingFile()
        panel.webview.postMessage({
          command: "installPartTwoDone"
        });
      }
      else if(msg.command==='readSchema'){

        try {

          const prismaSchemaPath = path.join(rootPath as string, "prisma", "schema.prisma");
          const schemaContent = fs.readFileSync(prismaSchemaPath, "utf-8");

          const parsedSchema = parsePrismaSchema(schemaContent);
          try{
            if(modelsFieldNames){
              outputChannel.appendLine('modelsFieldNames found'); outputChannel.show();
              outputChannel.appendLine('strModelNames:' + strModelNames); outputChannel.show();

              // outputChannel.appendLine(JSON.stringify(modelsFieldNames,null,2)); outputChannel.show();

            } else {
              outputChannel.appendLine('modelsFieldNames NOT found'); outputChannel.show();
            }
          }catch(err){
            const msg = err instanceof Error ? err.message : String(err);
            outputChannel.appendLine('No modelsFieldNames found '+ msg);  outputChannel.show();
          }
          // TODO: parse schemaContent and send back to WebView
          // ---------------------- JSON parser schemaModels via command sendingSchemaModel  ----------------------
          panel.webview.postMessage({
            command: "renderSchema",
            payload: parsedSchema,
            rootPath: rootPath,
            modelsFieldNames
          });
          // vscode.window.showErrorMessage('This is a test vscode.window.showErrorMessage');
        } catch (error) {
          vscode.window.showErrorMessage(
            `Failed to read schema: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
      else if (msg.command === 'createCrudSupport') {
        const {routeName, fields, embellishments } = msg.payload as {
          routeName: string;
          fields: string[];
          embellishments:string[];
        };
        outputChannel.appendLine(routeName + ' -- '+ JSON.stringify(fields,null,2) + ' -- '+ embellishments.join()); outputChannel.show();
        const pageSveltePath = path.join(routesPath, routeName, '/+page.svelte');
        outputChannel.appendLine(pageSveltePath); outputChannel.show();
        if (fs.existsSync(pageSveltePath)){
          const answer = await vscode.window.showWarningMessage(
            `There is a route ${routeName}. To overwrite it?`,
            { modal: true },
            'Yes',
            'No'
          );
          if(answer === 'No'){
            return
          }
        }
        type FuncList = {
          [funcName: string]: Function;
        };
        routeName_ = routeName;
        routeCName = routeName[0].toUpperCase() + routeName.slice(1);
        fields_= fields;
        embellishments_ = embellishments;
        // createUtils(routeName, fields);
        const funcList: FuncList = {
          'CRInput': createCRInput,
          'CRSpinner':createCRSpinner,
          'CRActivity': createCRActivity,
          'CRTooltip': createCRTooltip,
          'CRSummaryDetail': createSummaryDetail,
        }
        //  Object.values are function  references that create a specific page
        //  and are executed based on the embellishments content picking the
        // reference from the funcList above
        for(const fun of Object.values(embellishments)){
          try{
            funcList[fun]() // call the function reference
          }finally{}
        }
        createFormPage(includeTypes, outputChannel);
        buttons_();

        // create accompanying +page.server.ts file
        const pageServerPath = path.join(routesPath, routeName_, '/+page.server.ts')
        fs.writeFileSync(pageServerPath, getServerPage(), 'utf8');

        panel.webview.postMessage({
          command: "createCrudSupportDone"
        });
        outputChannel.appendLine(`[WebView] createCrudSupport DONE`);
        outputChannel.show(true);

        panel.webview.postMessage({
            command: "enableRemoveHint",
          });
      }
      else if(msg.command === 'saveTypes'){
        const appTypesPath = path.join(rootPath as string, '/src/lib/types/');
        if (!fs.existsSync(appTypesPath)) {
          fs.mkdirSync(appTypesPath, { recursive: true });
        }
        // includeTypes = msg.includeTypes;
        // vscode.window.showInformationMessage(includeTypes)
        const types = `
  // CRAppTypes from schema.prisma
  export type Role = 'USER' | 'ADMIN' | 'VISITOR';
  ${msg.payload.replace(/DateTime/g, 'Date').replace(/\bInt\b/g, 'Number').replace(/\?/g, '')}

`
        const appTypeFilePath = path.join(appTypesPath, 'types.ts')
        if (fs.existsSync(appTypeFilePath)) {
          let content = fs.readFileSync(appTypeFilePath, 'utf-8');
          if (!content.includes('// CRAppTypes')){
            fs.appendFileSync(appTypeFilePath, types, 'utf8');
          }
        }else{
          fs.writeFileSync(appTypeFilePath, types, 'utf8');
        }
      }
      else if(msg.command === 'log'){
        // vscode.window.showInformationMessage(`Bane command log ${msg.text}`);
        vscode.window.showInformationMessage(`log ${msg.text}`);
        // log should have at least a text property
        // Or log to output channel
        outputChannel.appendLine(`[WebView log outputChannel ${msg.text}] `);
        outputChannel.show(true); // false = don't preserve focus
      }
      else if(msg.command === 'cancel'){
        panel.dispose();
      }
    });
  });

  context.subscriptions.push(disposable);
}

function getWebviewContent(
  webview: vscode.Webview, 
  extensionUri: vscode.Uri, 
  noPrismaSchema:boolean, 
  installPartTwoPending:boolean): string {

  // Enable scripts in the webview
  webview.options = {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
  };

  // vscode.window.showInformationMessage('EXT: installPartTwoPending ' + installPartTwoPending);
  
  // returns a working HTML page that creates UI Form page with CRUD support
  return `<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <style>
    .main-grid {
      display: grid;
      grid-template-columns: 33rem 20rem;
    }

    .grid-wrapper {
      display: grid;
      grid-template-columns: 20rem 12rem;
      column-gap: 0.5rem;
      row-gap: 1rem;
    }


    .span-two,
    pre {
      grid-column: 1 / span 2;
      text-align: justify;
      font-size: 12px;
      color: skyblue;
    }


    #createBtnId {
      width: 12rem;
      padding: 4px 0;
      margin: 2rem 0 0 0;
      padding: 5px 0;
      opacity: 0.8;
    }

    #createBtnId:hover {
      opacity: 1;
    }

    input[type='text'] {
      width: 18rem;
      height: 20px;
      padding: 6px 0 8px 1rem;
      outline: none;
      font-size: 16px;
      border: 1px solid gray;
      border-radius: 4px;
      outline: 1px solid transparent;
      margin-top: 8px;
      margin-bottom: 10px;
    }

    input[type='text']:focus {
      outline: 1px solid gray;
    }

    .left-column {
      grid-column: 1;
    }

    .left-column label,
    .left-column label:focus {
      display: block;
      width: 12rem;
      cursor: pointer;

    }

    .fields-list {
      position: relative;
      cursor: pointer;
    }

    .middle-column {
      position: relative;
      grid-column: 2;
      border: 1px solid gray;
      border-radius: 5px;
      margin-top: 1.45rem;
    }

    .middle-column .candidate-fields-caption {
      position: absolute;
      top: -1.5rem;
      left: 0.5rem;
      color: skyblue;
    }

    .right-column {
      position: relative;
      border: 1px solid gray;
      border-radius: 6px;
      padding: 6px 3px 8px 10px;
      margin-top: 1.5rem;

    }

    #schemaContainerId {
      height: 30rem;
      overflow-y: auto;
    }

    .right-column .prisma-model-caption {
      position: absolute;
      top: -1.5rem;
      left: 0.5rem;
      display: inline-block;
      color: skyblue;
      cursor:pointer;
    }
    .collapse-all {
      color:lightgreen;
      font-size:12px;
      border: 1px solid gray;
      border-radius:4px;
      padding: 2px 0 2px 1rem;
    }
    .embellishments {
      position: relative;
      grid-column: span 2;
      display: grid;
      grid-template-columns: 1rem 20rem;

      column-gap: 0.5rem;
      row-gap: 0.1rem;
      align-items: center;
      padding: 8px 1rem;
      border: 1px solid gray;
      border-radius: 6px;
      margin-top: 3rem;
      user-select: none;
    }

    .checkbox-item {
      display: contents;
    }

    .checkbox-item input[type='checkbox'] {
      grid-column: 1;
      justify-self: start;
      align-self: center;
      margin: 0;
    }

    .checkbox-item label {
      grid-column: 2;
      justify-self: start;
      align-self: center;
      cursor: pointer;
      line-height: 1;
      width: 25rem !important;
    }

    .checkbox-item label:hover {
      background-color: cornsilk;
      cursor: pointer;
      width: 25rem !important;
    }

    /* for CSS class names inserted as a markup string into innerHTML
      class the names should be defined :global as they are in a new scope
      but WebView CSP Restrictions: VS Code WebViews have strict CSP
      and pseudo classes do not work, though they work in Svelte
    */
    .list-el {
      background-color: skyblue;
      width: max-100%;
      height: 20px;
      font-size: 18px;
      line-height: 18px;
      text-align: center;
      margin: 6px 0 0 0;
    }

    .list-el:hover {
      cursor: pointer;
    }

    .field-text {
      display: block;
      height: 20px;
      text-align: center;
    }

    .remove-hint {
      position: absolute;
      left: 1.5rem !important;
      z-index: 10;
      font-size: 12px;
      color: red;
      padding: 0 0.5rem 1px 0.5rem;
      background-color: cornsilk;
      opacity: 0;
      text-align: center;
      border: 1px solid lightgray;
      border-radius: 5px;
      transition: opacity 0.2s;
      pointer-events: none;
      white-space: nowrap;
    }

    .list-el:hover .remove-hint {
      opacity: 1;
    }

    .models-list {
      border: 1px solid gray;
    }

    .models-list ul {
      color: skyblue;
    }

    .models-list ul li {
      color: yellow;
    }

    .model-name {
      color: #3e3e3e;
      background-color: #e3e3e3;
      margin-top: 3px;
      width: calc(100% -1rem);
      border-radius: 6px;
      padding-left: 1rem;
      cursor: pointer;
    }

    .fields-column {
      display: grid;
      grid-template-columns: 7rem 9.5rem;
      column-gap: 5px;
      width: max-content;
      padding: 6px 0 6px 1rem;
      height: auto;
      font-family: Georgia, 'Times New Roman', Times, serif;
      font-size: 15px !important;
      font-weight: 500 !important;
    }

    .fields-column p {
      margin: 4px 0 0 0;
      padding: 2px 0 0 4px 6pc;
      border-bottom: 1px solid lightgray;
      text-wrap: wrap;
    }

    .fields-column p:nth-child(odd) {
      color: skyblue;
      cursor: pointer;
      width: 100%;
      padding: 2px 0 2px 0.5rem;
    }

    .fields-column p:nth-child(even) {
      font-weight: 400 !important;
      font-size: 12px !important;
    }

    button {
      display: inline-block;
      margin: 1rem 1rem 1rem 0;
      background-color: navy;
      color: yellow;
      border: 1px solid gray;
      border-radius: 5px;
      font-size: 12px;
      cursor: pointer;
      padding: 3px 1rem;
      user-select: none;
    }

    .crud-support-done {
      width: max-content;
      padding: 5px 2rem;
      margin:1rem 0 0 0;
      color: lightgreen;
      font-size: 14px;
      border: 1px solid gray;
      border-radius:5px;
      cursor:pointer;
      text-align: center;
    }
    .hidden {
      display: none;
    }
  </style>

</head>

<div>
  <h2 style='margin-left:8rem;'>Create CRUD Support</h2>

  <pre id='installPartOneId' class='hidden'>
      <h3>Prisma Installation Part One</h3>
The Extension Create CRUD Form Support found that Prisma ORM is not installed 
in your project and it can help you install it. In this first part of the 
installation it will add all the necessary packages and initiate Prisma in this 
project installing a very basic schema in /prisma/schema.prisma file at the project
root and set a connection string in the .env file that it created.
It will open schema.prisma and .env contents in separate windows and the Extension 
will display Prisma Installation Part Two page having a continue button waiting
for you to 
  1)  Specify your Prisma models/tables replacing the current schema.prisma content
  2)  Specify connection string in the opened .env with correct connection string
When you are done select the continue button to finis the installation with the commands
listed below. If you closed the Extension in order to finish the above tasks you could
issue the commands yourself or start the Extension again and it should display the
Prisma Installation Part Two page with the continue button.

          pnpx prisma migrate dev --name init
          // in case of a conflict with the previous migration history, run
          pnpx prisma migrate reset
          // and repeat
          pnpx prisma migrate dev --name init
          // and finally generate the Prisma client
          pnpx prisma generate
          <button id='installPartOneBtnId'>Install Prisma ORM</button><button id='cancelPartOneBtnId'>Cancel</button>
  </pre>

  <pre id='installPartTwoId' class='hidden'>
          <h3>Prisma Installation Part Two</h3>
We assume that you finished tasks 1) and 2)
  1)  Ctrl + double-click on .env file to open it beside this Extension and
      enter valid connection string and save the file
  2)  Ctrl + double-click on /prisma/schema.prisma to open it beside the Extension
      and prepare schema models/tables
      Use model abilities for setting defaults, generating Ids,...
      Save the model.
The extension  will issue the final commands for installing Prisma
when you select continue, otherwise you can enter yourself the
commands mentioned in the Prisma Installation Part One when 1) and 2)
are finalized:

    pnpx prisma migrate dev --name init
    // in case of a conflict with the previous migration history, run
    pnpx prisma migrate reset
    // and repeat
    pnpx prisma migrate dev --name init
    // and finally generate the Prisma client
    pnpx prisma generate

              <button id='installPartTwoBtnId'>continue</button><button id='cancelPartTwoBtnId'>cancel</button>  
  </pre>

  <div id='crudUIBlockId' class='main-grid hidden'>
    <div class='grid-wrapper'>
      <pre class="span-two">
To create a UI Form for CRUD operations against the underlying ORM fill
out the <i>Candidate Fields</i> by entering field names in the <i>Field Name</i> input
box with its datatype, e.g. firstName: string,  and pressing the Enter key
or expand a table from the <i>Select Fields from ORM</i> block and click on
a field name avoiding the auto-generating fields usually colored in pink.
The UI Form +page.svelte with accompanying +page.server.ts will be 
created in the route specified in the Route Name input box.
      </pre>

      <div class='left-column'>
        <label for="routeNameId">Route Name
          <input id="routeNameId" type="text" />
        </label>
        <label for='fieldNameId'>Field Name
          <input id="fieldNameId" type="text" />
        </label>
        <button id="createBtnId" disabled>Create CRUD Support</button>
        <div class='crud-support-done hidden'></div>
        <div id='messagesId' style='z-index:10;width:20rem;'>Messages:</div>
      </div>

      <div class='middle-column'>
        <span class='candidate-fields-caption'>Candidate Fields</span>
        <div class="fields-list" id="fieldsListId"></div>
        <p id="removeHintId" class='remove-hint'>click to remove</p>
      </div>


      <div class="embellishments">
        <div class="checkbox-item">
          <input id="CRInput" type="checkbox" checked />
          <label for="CRInput">CRInput component</label>
        </div>
        <div class="checkbox-item">
          <input id="CRSpinner" type="checkbox" checked />
          <label for="CRSpinner">CRSpinner component</label>
        </div>
        <div class="checkbox-item">
          <input id="CRActivity" type="checkbox" checked />
          <label for="CRActivity">CRActivity component</label>
        </div>
        <div class="checkbox-item">
          <input id="CRTooltip" type="checkbox" checked />
          <label for="CRTooltip">Tooltip component</label>
        </div>
        <div class="checkbox-item">
          <input id="CRSummaryDetail" type="checkbox" checked />
          <label for="CRSummaryDetail">Summary/Details component</label>
        </div>
      </div>
    </div>
    <div id='rightColumnId' class='right-column hidden'>
      <span class='prisma-model-caption' onclick="closeSchemaModels()">Select Fields from ORM</span>
      <div id="schemaContainerId">
      </div>
    </div>
  </div>
</div>
<body>
<script>
  // Webview Extension
  let tablesModel = 'waiting for schemaModels '
  let rootPath = ''
  const vscode = acquireVsCodeApi()
  const noPrismaSchemaL = ${noPrismaSchema} ? true : false;
  const installPartTwoPending = ${installPartTwoPending} ? true : false;

  let noSchemaText = 'based on variable noPrismaSchema got from getWebviewContent ' + noPrismaSchemaL ? 'FOUND NO SCHEMA' : 'YES, SCHEMA FOUND'

  function installPartTwo() {
    vscode.postMessage({ command: 'installPrismaPartTwo' })
  }
  function cancelAnyPart() {
    fields = []
    closeSchemaModels()
    vscode.postMessage({ command: 'cancel' })
  }
  // all the elements needed to handle Prisma installation two parts
  // and the main CRUD support UI
  let installPartOneEl
  let installPartTwoEl
  let installPartOneBtnEl
  let cancelPartOneBtnEl
  let installPartTwoBtnEl
  let cancelPartTwoBtnEl
  let crudUIBlockEl
  let rightColumnEl
  let schemaContainerEl
  let crudSupportDoneEl
  let fieldModelsJSON
  let fieldModels
  let theFields = [];
  let msgEl
  let labelEl
  let routeLabelNode
  let timer
  let noRemoveHint = false

  // Fires only one time
  // based on two variables noPrismaSchemaL and installPartTwoPending
  // prepare event listeners or if both are false make main page visible
  // This is how extension starts
  window.addEventListener('load', function () {
    // vscode.postMessage({ command: 'log', text: 'WINDOW LOAD EVENT CALLED' })

    crudUIBlockEl  = document.getElementById('crudUIBlockId')
    rightColumnEl = document.getElementById('rightColumnId')
    installPartOneEl = document.getElementById('installPartOneId')
    installPartTwoEl = document.getElementById('installPartTwoId')
    installPartOneBtnEl = document.getElementById('installPartOneBtnId')
    installPartTwoBtnEl = document.getElementById('installPartTwoBtnId')
    cancelPartOneBtnEl = document.getElementById('cancelPartOneBtnId')
    cancelPartTwoBtnEl = document.getElementById('cancelPartTwoBtnId')
    schemaContainerEl = document.getElementById('schemaContainerId')
    crudSupportDoneEl = document.querySelector('.crud-support-done')
    labelEl = document.querySelector("label[for='routeNameId']");
    routeLabelNode = Array.from(labelEl.childNodes).filter(
      (node) => node.nodeType === Node.TEXT_NODE
      )[0];
    msgEl = document.getElementById('messagesId')
    msgEl.addEventListener('dblclick', () => {
      msgEl.innerHTML = ''
    })


    if (noPrismaSchemaL){
      installPartOneBtnEl.addEventListener('click', () => {
        vscode.postMessage({ command: 'installPrisma' })
        installPartOneBtnEl.innerText = 'installing...'
      })
      cancelPartOneBtnEl.addEventListener('click', cancelAnyPart)
      // fires once so be ready it extension waits for schema and connection
      installPartTwoBtnEl.addEventListener('click', installPartTwo)
      cancelPartTwoBtnEl.addEventListener('click', cancelAnyPart)
    }
    if (installPartTwoPending){
      installPartTwoBtnEl.addEventListener('click', installPartTwo)
      cancelPartTwoBtnEl.addEventListener('click', cancelAnyPart)
    }
    // vscode.postMessage({ command: 'log', text: 'BEFORE TURNING PARTS VISIBLE' })

    if (noPrismaSchemaL) {
      console.log('console.log -- noPrismaSchemaL')
      // all blocks start hidden
      installPartOneEl.classList.remove('hidden')
    } 
    else if (installPartTwoPending){
      console.log('console.log -- installPartTwoPending')
      installPartTwoEl.classList.remove('hidden')
      // vscode.postMessage({ command: 'log', text: 'PRISMA PART TWO INSTALLATION' })
    }
    else {
      console.log('console.log -- Create CRUD Support')
      // setTimeout(() => {
      crudUIBlockEl.classList.remove('hidden')
      rightColumnEl.classList.remove('hidden')
      vscode.postMessage({ command: 'readSchema' })
      // }, 0)
    }
  })


  function closeSchemaModels(){
    routeNameEl.value = '';
    fieldNameEl.value = '';
    setTimeout(() => {
      const children = schemaContainerEl.children
      for (child of children) {
        const det = child;
        if (det.hasAttribute('open')) {
          det.removeAttribute('open')
        }
      }
      fields = []
      fieldsListEl.innerHTML = '';
    },0)
  }
  function attachPartTwoButtons() {
    installPartTwoBtnEl.removeEventListener('click')
    installPartTwoBtnEl.addEventListener('click', () => {
        vscode.postMessage({ command: 'installPrismaPartTwo' })
      })
      cancelPartTwoBtnEl.addEventListener('click', () => {
        vscode.postMessage({ command: 'cancel' })
      })
  }
  let installPartOneDone = false;
  // Re-run binding when visible:
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && installPartOneDone) {
      installPartTwoBtnEl.removeListener('click', installPartTwo);
      cancelPartTwoBtnEl.removeListener('click', cancelAnyPart);
      attachPartTwoButtons();
    }
  });

  // Listen for extension messages
  window.addEventListener("message", event => {
    
    const msg = event.data
    if (msg.command === 'installPartOneDone'){
      installPartOneDone = true;
      installPartOneEl.classList.add('hidden');
      // event handlers are already established
      installPartTwoEl.classList.remove('hidden');
      // vscode.postMessage({command: 'log',  text: 'EXT: installPartOneDone' });
    }
    
    if (msg.command === 'installPartTwoDone'){
      // vscode.postMessage({ command: 'log',  text: 'EXT: installPartTwoDone' });
      installPartTwoEl.classList.add('hidden');
      crudUIBlockEl.classList.remove('hidden');
      rightColumnEl.classList.remove('hidden');
      // Request schema from the active extension
      vscode.postMessage({ command: 'readSchema' })
    }
    if (msg.command === 'createCrudSupportDone') {
    // vscode.postMessage({ command: 'log', text: 'EXT: createCrudSupportDone confirmed' })
      fieldsListEl.innerHTML = ''
      routeNameEl.value = ''
      crudSupportDoneEl.classList.remove('hidden')
      setTimeout(()=>{
        crudSupportDoneEl.classList.add('hidden');
      }, 3000)
      closeSchemaModels();
    }
    if (msg.command === 'renderSchema') {
      // vscode.postMessage({command: 'log',  text: 'EXT: renderSchema' });
      renderParsedSchema(msg.payload)
      rootPath = msg.rootPath,
      fieldModels= msg.modelsFieldNames
    }
    if(msg.command === 'taskError'){
      vscode.postMessage({command: 'log',  text: 'EXT: Prisma installation err '+ msg.error});
    }
    if(msg.command === 'enableRemoveHint'){
      noRemoveHint = false
    }
  })

  // user clicks on fields list and it should click on a field name
  // rendered in skyblue
  function selectField(event) {
    const el = event.target
    const fieldName = el.innerText
    if (el.style.color === 'skyblue' && !fields.includes(fieldName)) {
      renderField(fieldName)
    }
  }
  // to send to an input box the Enter key up we need an event to dispatch
  const enterKeyEvent = new KeyboardEvent('keyup', {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
    bubbles: true
  })

  function dateTimeToDate(type) {
    if (type === 'DateTime') {
      return 'Date'
    }
    return type
  }

  let routeName = ''
  
  function changeLabelText(color, text, duration){

    // Update the first (and likely only) text node
    const nodeText = routeLabelNode.textContent;
    // vscode.postMessage({command:'log', text: 'found textNode '+ nodeText})
    routeLabelNode.textContent = text;
    labelEl.style.color = color;
    timer = setTimeout(() => {
      routeLabelNode.textContent = nodeText;
      labelEl.style.color = '';
    }, duration)
  }
  function clearLabelText(){
    clearTimeout(timer);
    // msgEl.innerHTML += '<br/>clearLabelText';

      labelEl.style.color = '';
      routeLabelNode.textContent = 'Route Name';

  }

  // a parsed schema from a Prisma ORM is sent back from the extension
  // and as it is an HTML collection we turn it into an Object with
  // entries to be destructed into individual object properties
  function renderParsedSchema(schemaModels) {

    // function addFieldnameToCandidateList(el){
    //   const fieldName = el.innerText
    //   vscode.postMessage({command:'log', text: fieldName})
    //   // let type = el.nextSibling.innerText.match(/type:\\s*(\\w+)/)?.[1];
    //   let type = dateTimeToDate(el.nextSibling.innerText.match(/type:(\\S+)/)?.[1])
    //   if (!'String|Number|Boolean|Role'.includes(type)) {
    //     return
    //   }

    //   // the standard procedure for entering a new fieldname is via input box + Enter
    //   if (el.tagName === 'P' && el.nextSibling.tagName === 'P' && !fields.includes(fieldName)) {
    //     // keep inputbox value so preserve it if any and restore it after
    //     const savedEntry = fieldNameEl.value
    //     fieldNameEl.value = \`\${fieldName}: \${type}\`
    //     fieldNameEl.dispatchEvent(enterKeyEvent)
    //     fieldNameEl.value = savedEntry
    //   }
    // }

    let markup = ''
    let types = ''
    let includeTypes = 'import type { '

    try {
      for (const [modelName, theFields] of Object.entries(schemaModels)) {

        types += \`
  export type \${modelName} = {
    \`
        includeTypes += modelName + ', '
        if (modelName === 'User') {
          includeTypes += 'Role, '
        }
        const [, fields] = Object.entries(theFields)[0]
        let m = ''


        for (const [fieldName, { type, prismaSetting }] of Object.entries(fields)) {
          if ('0|1'.includes(fieldName)) continue
          types += \`\${fieldName}: \${dateTimeToDate(type)};
    \`
          if (prismaSetting.includes('@default') || prismaSetting.includes('@updatedAt') || prismaSetting.includes('@unique')) {
            m += \`<p>\${fieldName}</p><p>type:\${type} <span style='color:pink'>\${prismaSetting ?? 'na'}</span></p>\`
          } else {
            m += \`<p>\${fieldName}</p><p>type:\${type} \${prismaSetting ?? 'na'}</p>\`
          }
        }


        types = types.slice(0, -3) +
          \` };
\`
        // render field name as a collapsed summary to reveal field list when expanded
        markup += \`<details>
          <summary class='model-name'>\${modelName}</summary>
          <div class='fields-column'>\${m}</div>
          </details>\`
      }
      includeTypes = includeTypes.slice(0, -2) + \` }  from '\$lib/types/types';
  \`
      vscode.postMessage({ command: 'saveTypes', payload: types, includeTypes })
    } catch (err) {
      vscode.postMessage({command: 'log',  text: 'renderParsedSchema: ' + err });
    }
    // now all the markup constructed as a string render into  schemaContainerEl
    schemaContainerEl.innerHTML = markup

    // schemaContainerEl gets click event but it has to be from the first <p> element
    // and that fieldname (innerText) id ignored if already saved in the fields
    schemaContainerEl.addEventListener('click', (event) => {

      if (event.target.tagName === 'SUMMARY') {
        const modelName = event.target.innerText;
        routeNameEl.value = modelName.toLowerCase();
        routeNameEl.focus()
        routeNameEl.click()
        const details = event.target.closest('details');
        if (details.open) {
          closeSchemaModels();
          clearLabelText();
          return;
        }
        changeLabelText('pink', 'Change Route Name if necessary', 4000)
        //----------------
        if (fieldModels){
          msgEl.innerHTML += '<br/>SUMMARY fieldModels found: '+ JSON.stringify(fieldModels) + ' modelName: '+ modelName;
          
          try{
            msgEl.innerHTML += '<br/>before theFields = fieldModels.User'
            theFields = Array.from(fieldModels[modelName]);
            // msgEl.innerHTML += '<br/>made an assignment theFields = fieldModels.User';
            if (theFields){
              // msgEl.innerHTML += '<br/>fieldModels[modelName] found for modelName: '+modelName;
              // msgEl.innerHTML += '<br/>JSON on the Fields: '+ JSON.stringify(theFields) + ' theFields.length '+ theFields.length;
              for (field of theFields){
                // msgEl.innerHTML += '<br/>theFields loop: '+ theFields[i];
                fieldNameEl.value = field;
                fieldNameEl.dispatchEvent(enterKeyEvent);
              }
              return
            }
          }catch(err){
            const msg = err instanceof Error ? err.message : String(err);
            msgEl.innerHTML += '<br/>fieldModels[modelName] NOT found err: '+ msg
          }
        }else{
          msgEl.innerHTML += '<br/>SUMMARY fieldModels NOT found'
        }
      }
      
      // the click is not on a SUMMARY, so a field name is clicked
      // msgEl.innerHTML += '<br/>the click is not on a SUMMARY'
      const el = event.target
      const fieldName = el.innerText
      let type = dateTimeToDate(el.nextSibling.innerText.match(/type:(\\S+)/)?.[1])
      if (!'String|Number|Boolean'.includes(type)) {
        return
      }

      // the standard procedure for entering a new fieldname is via input box + Enter
      if (el.tagName === 'P' && el.nextSibling.tagName === 'P' && !fields.includes(fieldName)) {
        // we need input box so preserve its entry if any and restore after
        const savedEntry = fieldNameEl.value
        fieldNameEl.value = \`\${fieldName}: \${type}\`
        fieldNameEl.dispatchEvent(enterKeyEvent)
        fieldNameEl.value = savedEntry
      }
    })
  }

  // FieldsList elements use inline style for high specificity as they are created dynamically 
  // by inserting innerHTML, so the inline style is in the listElCSS variable
  const listElCSS = 'color:black; font-size:14px; font-weight: 400; background-color: skyblue; margin: 2px 0 0 0;'

  // its data-filed-index are read via el.getAttribute('data-field-index')
  // or using camel case property name replacing 'data-' with .dataset
  // el.dataset.fieldIndex where data-field-index turn to .dataset.fieldIndex 

  let fields = []
  // for removing element from the fields list every fieldName is given short id
  // as data-field-index HTML attribute and received on click event and read
  const getUniqueId = () => {
    // convert to a string of an integer from base 36
    return Math.random().toString(36).slice(2)
  }

  const removeHintEl = document.getElementById('removeHintId')
  removeHintEl.style.opacity = '0'    // make it as a hidden tooltip

  // when a fieldsList schemaContainerEl is full scroll it so the last element
  // is exposed visible
  const scroll = (el) => {
    if (
      el.offsetHeight + el.scrollTop >
      el.getBoundingClientRect().height - 20
    ) {
      setTimeout(() => {
        el.scrollTo(0, el.scrollHeight)
      }, 0)
    }
  }
  // and the route name is specified
  const disableCreateButton = () => {
    createBtnEl.disabled = !fields.length || !routeName
  }

  function adjustFiledNameAndType(val) {
    val = val.replace(/\\s+/g, '')

    if (!val.match(/\\s*[a-zA-z0-9_]+\\s*\\:\\s*([a-zA-z0-9_]+)/)?.[1]) {
      val = val.replace(/\\:.*\$/, '') + ': string'
    } else {
      val = val.replace(/([a-zA-z0-9_]+)\:([a-zA-z0-9_]+)/, '\$1: \$2')
    }
    return val
  }

  // the two input boxes for route name and fieldName, which is
  // used repeatedly for making Candidate Fields
  const routeNameEl = document.getElementById('routeNameId')
  const fieldNameEl = document.getElementById('fieldNameId')

  const fieldsListEl = document.getElementById('fieldsListId')
  const createBtnEl = document.getElementById('createBtnId')

  routeNameEl.addEventListener('input', (e) => {
    routeName = e.target.value
    disableCreateButton()
  })
  routeNameEl.addEventListener('click', (e) => {
    routeName = e.target.value
    disableCreateButton()
  })

  if (fieldNameEl) {
    fieldNameEl.addEventListener('keyup', (event) => {
      // vscode.postMessage({command: 'log',  text: 'fieldNameEl.addEventListener created' });
      let v = fieldNameEl.value.trim().replace(/\\bstring\\b/, 'String')
      if (!v) {
        // vscode.postMessage({command: 'log',  text: 'field is empty' });
        return
      }
      v = adjustFiledNameAndType(v)
      if (fields.includes(v)) {
        setTimeout(() => {
          fieldNameEl.style.color = 'red'
        }, 0)
        return
      }
      if (fieldNameEl.style.color === 'red') {
        fieldNameEl.style.color = 'black'
      }
      if (event.key !== 'Enter') return
      fields.push(v)
      disableCreateButton()
      renderField(v)
      fieldNameEl.value = ''
      scroll(fieldsListEl)
    })
  }
// we do not clear all the entries and rebuild from the fields
  // but just add a newly entered in the Field Name fieldNameId
  function renderField(fieldName) {

    const fieldNameFromIndex = (index) => {
      const listEls = fieldsListEl.querySelectorAll('.list-el')
      let name = ''
      // forEach 
      listEls.forEach(listEl => {
        if (listEl.dataset.fieldIndex === index) {
          name = listEl.firstChild.innerText
        }
      })
      return name
    }
    // Create elements
    const div = document.createElement('div')
    const span = document.createElement('span')

    // Set attributes and content
    div.className = 'list-el'
    div.dataset.fieldIndex = getUniqueId()
    div.style.setProperty('--hover-display', 'none')
    div.style.cssText = listElCSS

    span.className = 'field-text'
    span.textContent = fieldName

    // Append structure
    div.appendChild(span)
    fieldsListEl.appendChild(div)

    // so getBoundingClientRect() can be destructured
    // const { x, y } = fieldsListEl.getBoundingClientRect()
    setTimeout(() => {
      const listEls = fieldsListEl.querySelectorAll('.list-el')
      listEls.forEach(el => {
        el.addEventListener('mouseenter', () => {
          if (noRemoveHint) return
          removeHintEl.style.top = String(el.offsetTop - el.offsetHeight) + 'px'
          removeHintEl.style.left = String(el.offsetLeft + 12) + 'px'
          removeHintEl.style.opacity = '1'
        })

        el.addEventListener('mouseleave', () => {
          removeHintEl.style.opacity = '0'
        })

        el.addEventListener('click', () => {
          removeHintEl.style.opacity = '0'

          if (fieldNameEl.value === '') {
            fieldNameEl.value = el.innerText
            fieldNameEl.focus()
          }
          const index = el.dataset.fieldIndex
          const fieldName = fieldNameFromIndex(index)
          fields = fields.filter(el => el !== fieldName)
          el.remove()
        })
      })
    }, 400)
  }
  const selectedCheckboxes = () => {
    // Get all checkboxes in the document
    const checkboxes = document.querySelectorAll('input[type="checkbox"]')
    // Array of checked checkbox IDs only
    return Array.from(checkboxes)
      .filter(checkbox => checkbox.checked)
      .map(checkbox => checkbox.id)
  }

  createBtnEl.addEventListener('click', (event) => {
    noRemoveHint = true
    if (routeName && fields.length) {
      // user has chance to change route name 
      document.querySelector('.crud-support-done').innerHTML = "route <span style='color:pink;'>" + routeNameEl.value + "</span>  created";
      const payload = { routeName, fields, embellishments: selectedCheckboxes() }
      vscode.postMessage({ command: 'createCrudSupport', payload: payload })
    }
  })
</script>
</body>

</html>`;
}

