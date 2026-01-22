
import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
// to find the work folder path
import * as childProcess from 'child_process'


const pgPassPath = path.join(os.homedir(), '.pgpass')
let inputBoxWidth_ = ''
let rootPath = ''
let routesPath = ''
let routeName_ = ''
let modelObjName_ = ''
let modelObjName_s = ''
let modelObjCName_ = ''
let fields_: string[] = []
let lowerCaseTypes = ''
let pendingFile = ''
interface IStringBoolean {
  [key: string]: boolean
}
interface IStrKeyStrVal {
  [key: string]: string
}
let db_: IStrKeyStrVal = {}
interface ISelectBlocks {
  [key: string]: IStrKeyStrVal
}
let selectBlocks: ISelectBlocks = {}
let sudoName_ = ''
let embellishments_: string[] = []
let terminal: vscode.Terminal | undefined
let noPrismaSchema = false
let installPartTwoPending = false
let pm = 'unknown'
let ex = 'unknown'

// ------------------------------------------------------
// beginning of modelFields.Model where Model is from schema.prisma model/table name
type TmodelFields = {
  [key: string]: Array<[name: string, type: string]>
}

// Remove 'export type', newlines, and curly braces.
// Deliberately keep the semicolons to help split fields later.
const cleanedString = lowerCaseTypes
  .replace(/export type/g, '') // Remove keywords
  .replace(/[\n\r\s]+/g, '')   // Remove all whitespace/newlines
  .replace(/[{}]/g, '')       // Remove brackets

// Use a regex to capture "Name=Body" pairs.
// The pattern matches: (Word)=(Anything until the next Name= or end of string)
const rawBlocks = cleanedString.split(';').filter(Boolean)

// Make an empty object to fill it up
const modelFields: TmodelFields = {}

// Revised Strategy:
// 1. Split by '=' to get segments.
// 2. The first segment is the first Name.
// 3. The middle segments contain "PreviousBodyName".
// 4. The last segment is just "LastBody".

const segments = cleanedString.split('=')

for (let i = 0; i < segments.length - 1; i++) {
  // The key is the end of the current segment (or the whole thing if it's the first)
  // The body is the start of the next segment.

  let objectName: string
  let rawBody: string

  if (i === 0) {
    objectName = segments[i] // "User"
  } else {
    // segment[i] looks like "string;Profile"
    // Split the previous body from the new name
    const parts = segments[i].split(';')
    objectName = parts.pop()! // The last part is the new name "Profile"
    // The rest is part of the previous body, but we handle bodies in the loop look-ahead (i+1)
  }

  // Now look at the NEXT segment to find the body for this objectName
  // segment[i+1] starts with the body fields: "bio:string;createdAt:Date;..."
  // It ends with the start of the next object name (if not the last segment).

  let bodySegment = segments[i + 1]

  // If this isn't the very last segment, we need to chop off the next Object's name from the end
  if (i < segments.length - 2) {
    const parts = bodySegment.split(';')
    parts.pop() // Remove the next object name
    rawBody = parts.join(';')
  } else {
    // Last segment
    rawBody = bodySegment
  }

  const fields: Array<[string, string]> = rawBody
    .split(';')
    .filter(Boolean)
    .map((fieldStr) => {
      const [fieldName, fieldType] = fieldStr.split(':')
      return [fieldName, fieldType]
    })

  modelFields[objectName] = fields
}

// Usage for(const [name, type] of modelFields.User){...}
// using only field names [name, ] of ...
// using only type [ , type] of ...
// end of building modelFields
// ---------------------------------------------------------
type Models = {
  [modelName: string]: string[]
}
const modelsFieldNames: Models = {}
function fNamesList(excludeName: string = '') {
  let fList = ``
  for (const field of fields_) {
    const fieldName = field.split(':')[0]
    if (fieldName !== excludeName) {
      fList += `${fieldName}, `
    }
  }
  return fList.slice(0, -2)
}

/*
  fields_: [
    "id: string",
    "userId: string",
    "title: string",
    "content: string",
    "priority: number",
    "updatedAt: date",
    "completed: boolean"
  ]
*/
function dbSelectListDataEntry(kind: string, strToNum: boolean = false) {
  let f = ``
  switch (kind) {
    case 'Select': {
      fields_.forEach(field => {
        if (!field.includes('password')) {
          f += field.replace(/"/g, '') + ',\n'
        }
      })
      return f
    }
    case 'List': {
      return (fields_.join() + ',').replace(/:\s*?\w+,/g, ', ').slice(0, -2)
    }
    case '?List': {
      return (fields_.join() + ',').replace(/:/g, '?:').replace(/:\s*?\w+,/g, ', ').slice(0, -2)
    }
    case 'formData': {
      return (fields_.join() + ',').replace(/,/g, ',\n\t\t\t').slice(0, -4)
    }
    case '?formData': {
      return (fields_.join() + ',').replace(/:/g, '?:').replace(/,/g, ',\n\t\t\t').slice(0, -4)
    }
    case 'DataEntry': {
      return fields_.join()
        .replace(/updatedAt:.*?Da/, 'updatedAt')
        .replace(/id,/, '')
        .replace(/:\s*?\w+,/g, ',\n\t\t\t')
        .slice(0, -2)
        .replace(/password/, 'passwordHash: await bcrypt.hash(password, 10)') +
        ',\n\t\t\t\t\tuserAuthToken: crypto.randomUUID()'
    }
    default: {
      return ''
    }
  }
}

// every object to sort its leading props per the ordered array
const ordered = [
  'id', 'authorId', 'userId', 'employeeId', 'customerId', 'ownerId',
  'firstName', 'lastName', 'middleName', 'name', 'profileId', 'dob',
  'dateOfBirth', 'email', 'password', 'address', 'city', 'state',
  'title', 'content', 'category', 'role', 'priority', 'price', 'updatedAt'
]
function sortArrByOrdered(arr: string[]) {
  const orderedPart = ordered.map((key) => arr.find((item) => item.startsWith(key + ':'))).filter(Boolean)
  const leftoverPart = arr.filter((item) => {
    const key = item.split(':')[0].trim()
    return !ordered.includes(key)
  })
  return [...orderedPart, ...leftoverPart]
}
// selectBlocks['User'] returns object of  id: "string | null", firstName: "string | null", ...
// 
function createSelectBlocks(partialTypes: string) {
  // Regex to capture: "UserPartial" and the "{...}"
  const typeRegex = /export\s+type\s+(\w+)Partial\s*=\s*\{([\s\S]*?)\};/g
  let match
  while ((match = typeRegex.exec(partialTypes)) !== null) {
    const objectName = match[1]     // e.g. "User"
    const body = match[2].trim()    // content inside { ... }
    // Split lines inside the type body and pre-order
    const lines = sortArrByOrdered(body
      .split("\n")
      .map(l => l.trim())
      .filter(l => l.length && l.includes(":"))
    )
    // Convert each line "key: value;" → { key: "value" }
    const obj: IStrKeyStrVal = {}
    for (const line of lines) {
      const [key, value] = (line?.replace(";", "").split(":") as string[]).map(x => x.trim())
      obj[key] = value
    }
    selectBlocks[objectName] = obj
  }
}
// blockChangeProps('User', 'no null') returns object of id: string, firstName: string, ...
// blockChangeProps('User') returns object of id: true, firstName: true, ...
// blockChangeProps('User', ': string') turns every prop type to string id: string, firstName: string, ...
function blockChangeProps(block: string, prop: string = ': true') {
  // initial props "string | null" to be replaced with the prop
  // or when prop === 'no null' to remove | null from prop type
  let list = `{ `
  for (const [k, v] of Object.entries(selectBlocks[block])) {
    if (prop === 'no null') {
      list += `${k}: ${v.replace(/ \| null/, ', ')}`
    } else {
      list += `${k}${prop}, `
    }
  }
  return list.slice(0, -2) + ' }'
}

function fieldsList(block: string) {
  return Object.keys(selectBlocks[block])
    .join()
    .replace(/password,?/, '')
    .replace(/,/g, ': true, ') + ': true'
}

function fieldTypeList(excludeName: string = '') {
  let fieldTypeList = ``
  for (const field of fields_) {
    if (field !== excludeName) {
      fieldTypeList += `${field}
      `
    }
  }
  return fieldTypeList.slice(0, -7)
}
function passwordHashAndToken() {
  if (modelObjName_ !== 'user') {
    return '' // TODO
  }
  return `passwordHash: await bcrypt.hash(password, 10),
				userAuthToken: crypto.randomUUID()
		`.slice(0, -3)
}
function getHelpersPage() {
  return `// helpers.ts
import { browser } from '$app/environment';
export const sleep = async (ms: number) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      // ms here is a dummy but required by
      // resolve to send out some value
      resolve(ms)
    }, ms)
  })
}

export const sixHash = () => {
  const a = (Math.random() * 46656) | 0;
  const b = (Math.random() * 46656) | 0;
  return a.toString(36).slice(-3) + b.toString(36).slice(-3);
};
export const id = () => {
  return (Math.random() * 10 ** 8).toString(36).replace(/\./g, '')
}

interface IDbRecord {
  [key: string]: string|number|boolean|object;  
}
export const toNumerics = (data: IDbRecord) => {
  let list = \`{ \`;
  fields_.map((row:string, index:number) => {
    const [ name, type ] = row.replace(/\s+/g,'').split(':');
    const d = data[index];
    list += (type==='number') ? Number(d)
                              : 'boolean|Date'.includes(type) 
                                ? d
                                : \`'\${d}'\`
    list += ', ';
  });
  return list.slice(0, -2)+ ' }';
}
export const resetButtons = (buttons: HTMLButtonElement[]) => {
  try {
    buttons.forEach((btn) => {
      btn.classList.remove('hidden')
      btn.classList.add('hidden')
        btn.hidden = true
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log('resetButtons', msg)
  }
}

export const hideButtonsExceptFirst = (buttons: HTMLButtonElement[]) => {
  resetButtons(buttons);
  if (buttons[0] && buttons[0].classList.contains('hidden')) {
    buttons[0].classList.toggle('hidden')
    buttons[0].hidden = false
  }
}

export const getCSSValue = (varName: string): string | undefined => {
  if (!browser) return;
  try {
    const root = document.documentElement;
    const value = getComputedStyle(root).getPropertyValue(varName).trim();
    return value || undefined;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log('getCSSValue', msg)
  }
};

export const setCSSValue = (varName: string, value: string, priority:string=null) => {
  try {
    if (browser) {
      const root = document.querySelector(':root') as Node
      if (root) {
        root.style.setProperty(varName, value, priority)
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log('setCSSValue', msg)
  }
}

export const setTextColor = (varName: string, color: string, priority:string=null) => {
  try {
    if (browser) {
      const root = document.querySelector(':root')
      if (root) {
        root.style.setProperty(varName, color, priority)
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log('setTextColor', msg)
  }
}

Number.prototype[Symbol.iterator] = function* () {
  for (let i = 0; i < this; i++) {
    yield i
  }
}

export const setPlaceholderColor = (color: string) => {
  if (browser) {
    document.documentElement.style.setProperty('--PLACEHOLDER-COLOR', color)
    setTextColor('--MESSAGE-COLOR', color === 'red' ? 'pink' : color)
  }
}

export const capitalizes = (str: string) => {
  str = str.replace(/_/gm, ' ').trim();
  let s = (str[0] as string)?.toUpperCase() + str.slice(1);
  return s.replace(/\b[a-z](?=[a-z]{2})/g, (char: string) => char.toUpperCase());
};

String.prototype.capitalize = function () {
  return capitalize(this as string)
}

// compare $state(object) with object
export function sameDeep(v1: any, v2: any): boolean {
  if (v1 === v2) return true;

  if (v1 instanceof Date && v2 instanceof Date)
    return v1.getTime() === v2.getTime();

  if (typeof v1 !== 'object' || typeof v2 !== 'object' || v1 == null || v2 == null)
    return false;

  const keys1 = Object.keys(v1);
  const keys2 = Object.keys(v2);
  if (keys1.length !== keys2.length) return false;

  for (const k of keys1) {
    if (!same(v1[k], v2[k])) return false;
  }

  return true;
}

export function same<T extends Record<string, any>>(v1: T, v2: T): boolean {
  if (v1 === v2) return true;

  const keys = Object.keys(v1);
  if (keys.length !== Object.keys(v2).length) return false;

  for (const k of keys) {
    if (v1[k] !== v2[k]) return false;
  }
  return true;
}`
}

function getPrismaClient() {
  return `
import { PrismaClient } from '@prisma/client';
// export const db = new PrismaClient();
export const db = new PrismaClient({
  log: ['warn', 'error']
});
// log: ['query', 'info', 'warn', 'error']
`
}

function getPartialTypes() {
  let lowercaseTypes = lowerCaseTypes.replace(/(\s*?).*?password.*?:/mg, '$1\t\tpassword:').replace(/export type (\w+)\s*=/g, 'export type $1Partial =')
  const allowedFields = 'string|number|boolean|Date|Role|password'
  const excludedFields = '[]|createdAt|Hash|Token|Post|Blog|User|Category|Todo|Profile'
  let allowedRegex = new RegExp(allowedFields)
  let excludedRegex = new RegExp(excludedFields)
  function uiField(field: string) {
    let ok = field.match(allowedRegex)
    let nok = field.match(excludedRegex)
    return ok && !nok
  }
  // as the lowercaseTypes begin with split string 'export type' the first
  // entry will hold an empty type , so skip it with sp.slice(1)
  const sp = lowercaseTypes.split('export type')
  let f = ''
  sp.slice(1).forEach((type: string) => {
    let fields = type.split('\n')
    f += 'export type ' + fields[0] + '\n'
    fields.slice(1, -1).forEach(field => {
      if (uiField(field)) {
        f += field.replace(/;/, ' | null;\n')
      }
    })
    f += '};\n'
  })
  return f + `
export type TCRInput = typeof CRInput;
export type TCRActivity = typeof CRActivity;
export type TCRTooltip = typeof CRTooltip;
export type TCRSpinner = typeof CRSpinner;
export type TCRSummaryDetail = typeof CRSummaryDetail;
export interface IStringBoolean {
  [key: string]: boolean;
}
  `
}

function getHooksPage() {

  return `
  import { redirect } from '@sveltejs/kit';
  import type {Handle} from '@sveltejs/kit';
  import { db } from '$lib/server/db';

  export const handle: Handle = (async ({ event, resolve }) => {
    let session='empty session';
    try {
      // getting cookie from the browser
      session = event.cookies.get('session');
      
      if (!session) {
        event.locals.user = {
          id: '',
          firstName: '',
          lastName: '',
          email:'',
          password:'',
          roles: ['VISITOR']
        };
        // prohibit access to ADMIN/USER-only allowed pages
        // TODO create the list of must-login-first pages
        if ('|fetch|news|store|comments|'.includes(\`|\${event.url.pathname.slice(1)}|\`)) {
          throw redirect(303, '/login');
        }
        event.url.pathname = '/'
        return await resolve(event);
      }
    } catch (unk) {
      console.log('event.cookies.getSession', error);
    }

    try {
      // we can now authenticate user if logged in
      const user = await db.user.findUnique({
        where: {
          userAuthToken: session
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email:true,
          role: true
        }
      });

      if (user) {
        event.locals.user = {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          password:'',
          role: user.role
        }
      }else{
        event.locals.user = {
          id: '',
          firstName: '',
          lastName: '',
          email:'',
          password:'',
          role: 'VISITOR'
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log('hook getUser', msg)
    }
    // console.log('hooks locals',event.locals);
    return await resolve(event);
  }) satisfies Handle;`
};
function shouldSelectUsers() {
  if (modelObjName_ !== 'user') {
    return `const users = await db.user.findMany({
    select: ${blockChangeProps('User').replace(/password: true,/, '')}
  });`
  }
  return ''
}
// called for User and other objects models
function getServerPage() {
  let imp = `
import { db } from '$lib/server/db';
import type { PageServerLoad } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import type RequestEvent from '@sveltejs/kit';
import type { Actions } from '@sveltejs/kit';
import { fail } from '@sveltejs/kit';
import * as utils from '$lib/utils';
import* as Types from '$lib/types/types';

export const load: PageServerLoad = (async ({locals}) => {
	const ${modelObjName_s} = await db.${modelObjName_}.findMany({
		select: ${blockChangeProps(modelObjCName_).replace(/password: true,/, '')},
    orderBy:{
			id: 'asc'
		}
  }) as Types.${modelObjCName_}Partial[];

	if (! ${modelObjName_s}) {
		return fail(400, { message: 'No  ${modelObjName_s} in db' });
	}
  
  ${shouldSelectUsers()}
	return {
    locals,
    users,
		${modelObjName_s}
	};
}) satisfies PageServerLoad;

export const actions: Actions = {
	create: async ({ request }) => {
    // exclude id from the list of columns
    let { ${fNamesList('id')} } = Object.fromEntries(
      await request.formData()
    ) as {
      ${fieldTypeList('id')}
    };
    console.log( ${fNamesList('id')} )
    if (!(${fNamesList('id').replace(/,/g, ' &&')})) {
      return fail(400, {
        data: {
          ${fNamesList('id').replace(/password,?\s*?/, '')}
        },
        message: 'Insufficient data supplied'
      })
    }


    const ${modelObjName_}Exists = await db.${modelObjName_}.findFirst({
      where: utils.toNumerics(${fNamesList('id').replace(/password,?\s*?/, '').replace(/role,?\s*?/, '')})
    })
    if (${modelObjName_}Exists) {
      return fail(400, {
        data: { ${fNamesList('id').replace(/password,?\s*?/, '')} },
        message: 'Unacceptable data'
      })
    }
    const ${modelObjName_} = await db.${modelObjName_}.create({
      data: {
        ${fNamesList('id').replace(/password,?\s*?/, '')},
        ${passwordHashAndToken()}
      }
    })
    await utils.sleep(2000);
    return {
      success: true,
      ${modelObjName_},
      message: '${modelObjName_} created successfully'
    }
  },
  // ------------------------------------------------
  update: async ({ request }) => {
    let data = Object.fromEntries(
      await request.formData()
    ) as {
      ${dbSelectListDataEntry('?formData')}
    }
    // if (idIsNumeric){
        data = utils.toNumerics(data);
    // }
    const { ${dbSelectListDataEntry('List')} } = data
    if (!(${dbSelectListDataEntry('List').replace(/,/g, ' || ')} )) {
      return fail(400, {
        data: { ${dbSelectListDataEntry('List').replace(/password./, '')} },
        message: 'Insufficient data supplied'
      })
    }

    try {
      await db.${modelObjName_}.update({
        where: {
          id
        },
        data,
      });
      await utils.sleep(2000);
      return {
        ${dbSelectListDataEntry('List').replace(/password,/, '')},
        success: "${modelObjCName_} updated successfully",
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return fail(500, { message: 'Internal error occurredL ' + msg });
    }
  },
  // ------------------------------------------------
  delete: async ({ request }) => {
    let data = Object.fromEntries(
      await request.formData()
    ) as {
      ${dbSelectListDataEntry('?formData')}
    }

    // if (idIsNumeric){
        data = utils.toNumerics(data)
    // }
    const { ${dbSelectListDataEntry('List')} } = data
    if (!(${dbSelectListDataEntry('List').replace(/,/g, ' || ')} )) {
      return fail(400, {
        data: { ${dbSelectListDataEntry('List').replace(/password./, '')} },
        message: 'Insufficient data supplied'
      })
    }

    try {
      await db.${modelObjName_}.delete({
        where: {
          id
        }
      });
      await utils.sleep(2000);
      return {
        ${dbSelectListDataEntry('List').replace(/password,/, '')},
        success: "${modelObjCName_} deleted successfully",
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return fail(500, { message: 'Internal error occurredL ' + msg });
    }
  }
} satisfies Actions
`
  return imp
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
SECRET_API_KEY=1234567890`

const sleep = async (ms: number) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      // ms here is a dummy but required by
      // resolve to send out some value
      resolve(ms)
    }, ms)
  })
}


function createPendingFile() {

  if (!fs.existsSync(pendingFile)) {
    fs.writeFileSync(pendingFile, 'install Prisma PartOne is done.\nInstallPartTwo is pending but may be already done by User.')
  }
}
function deletePendingFile() {
  if (fs.existsSync(pendingFile)) {
    fs.unlink(pendingFile, (err) => {
      if (err) {
        vscode.window.showInformationMessage('Could not delete installPartTwo.pending file at /prisma. Please delete it yourself')
      }
    })
  }
  if (fs.existsSync(pgPassPath)) {
    fs.unlink(pgPassPath, (err) => {
      if (err) {
        vscode.window.showInformationMessage('Could not delete .pgpass file at /home directory. Pleae delete it yourself')
      }
    })
  }
  const prismaConfigFile = path.join(rootPath, 'prisma.config.ts')
  fs.writeFileSync(prismaConfigFile, `import "dotenv/config"
  export default {
    schema: "prisma/schema.prisma",
    migrations: {
      path: "prisma/migrations",
    },
    datasource: {
      url: process.env.DATABASE_URL,
    },
  }`)
}
type PMErr = { err: string }
function detectPackageManager(): 'npm' | 'pnpm' | 'yarn' | 'bun' | PMErr {

  if (fs.existsSync(path.join(rootPath, 'pnpm-lock.yaml'))) return pm = 'pnpm'
  if (fs.existsSync(path.join(rootPath, 'yarn.lock'))) return pm = 'yarn'
  if (fs.existsSync(path.join(rootPath, 'bun.lockb'))) return pm = 'bun'
  if (fs.existsSync(path.join(rootPath, 'package-lock.json'))) return pm = 'npm'

  return { err: 'unknown' }
}
function xPackageManager(pm: string): 'npx' | 'pnpx' | 'yarn dlx' | 'bunx' | 'unknown' {
  switch (pm) {
    case 'npm': return ex = 'npx'
    case 'pnpm': return ex = 'pnpx'
    case 'bun': return ex = 'bunx'
    case 'yarn': return ex = 'yarn dlx'
    default: return ex = 'unknown'
  }
}

// Promise wrapper for childProcess.exec
function execShell(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    childProcess.exec(cmd, { cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`Command failed: ${stderr}`))
        return
      }
      resolve(stdout)
    })
  })
}

function sendToTerminal(cmd: string) {
  if (!terminal) {
    terminal = vscode.window.createTerminal(`WebView Terminal`)
  }
  terminal.show(true) // reveal the terminal
  terminal.sendText(cmd)
}

function ensureComponentPath() {
  // console.log('embellishments_', embellishments_)
  try {
    const componentsPath = path.join(rootPath as string, '/src/lib/components')
    if (!fs.existsSync(componentsPath)) {
      fs.mkdirSync(componentsPath, { recursive: true })
    }
    return componentsPath
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log('enshure component path', msg)
    return false
  }
}

function noType(name: string) {
  return name.match(/([a-zA-z0-9_]+)\:?.*/)?.[1]
}
let buttons = `<div class='buttons'>
      `
function spinners_() {
  const spinner: boolean = embellishments_.includes('CRSpinner');
  ['create', 'update', 'delete', 'clear'].forEach((caption) => {
    // const faction = caption === 'clear' ? 'clear': caption
    const cap = caption[0].toUpperCase() + caption.slice(1)
    const hid = cap === 'Clear' ? 'false' : `dBtn${cap}`
    const spinOn = cap === 'Clear' ? 'false' : `spin.${caption}`
    if (spinner) {
      buttons += `    <CRSpinner
            bind:button={btn${cap}}
            spinOn={${spinOn}}
            caption=${caption}
            formaction="?/${caption}"
            hidden={${hid}}
            {color}
          >
          </CRSpinner>
          `
    } else {
      buttons += `<button bind:this={btn${cap}} name="${caption}" formaction="?/${caption}">${caption}</button>
          `
    }
    buttons + `</div>
      `
  })
  return ''  // called as ()=>void with no return output is 'undefined'
}

function asType(type: string) {
  console.log('asType type:', type)
  switch (type) {
    case 'string': {
      return 'as string'
    }
    case 'number': {
      return 'as number'
    }
    case 'boolean': {
      return 'as boolean'
    }
    case 'role': {
      return 'as Types.Role'
    }
    case 'date': {
      return 'as Date'
    }
  }
  return ''
}

function inputType(name: string, type: string) {
  name = name.toLowerCase()
  type = type.toLowerCase()
  if (name === 'password') {
    return 'password'
  }
  if (type === 'number') {
    return 'number'
  }
  return 'text'
}

function toCapitalize(name: string, type: string) {
  if ('id|password|email'.includes(name.toLowerCase())) {
    return false
  }
  return true
}

function inputBox(name: string, type: string) {
  const required = name === 'id' ? '!dBtnCreate' : '!dBtnUpdate'
  const bindEl = `bind:this={${name}El}`
  if (embellishments_.includes('CRInput')) {
    if ('radio|checkbox'.includes(type)) {
      return `<CRInput 
        title="${name}"
        ${bindEl}
        type='${type}'
        bind:checked={snap.${name} ${asType(type)}}
        required={${required}}
        width="${inputBoxWidth_}"
      >
      </CRInput>
      `
    }
    return `<CRInput 
        title="${name}"
        ${bindEl}
        exportValueOn="enter|blur"
        type='${inputType(name, type)}'
        capitalize={${toCapitalize(name, type)}}
        bind:value={snap.${name} ${asType(type)}}
        required={${required}}
        width="${inputBoxWidth_}"
      >
      </CRInput>
      `
  }
  // standard input boxes required
  return `<input type="hidden" name="${name}" bind:value={snap.${name}} />
  `
}

function submitFunc() {
  return
}
let ix = 0 // render up to five object properties in the rowList
// key added as key: utils.sixHash() to db select object list 
// as Svelte needs unique id for {#each } loop
let rowList = '<p id={row.key}>' // TODO replace row with summary/details rendered via snippet
let set = new Set<string>()
let variables = ``
let uiElementsStr: string[] = []
let theInitValues: string[] = []
let uiSelectFields = ``
function initValues() {
  let uiSelect = new Set<string>()
  let updateFields = ``
  let partialType = `type ${modelObjCName_}Partial = {
    `
  let clean_snap = ''
  const fields: string[] = []
  fields_.forEach(fName => {
    const m = (fName as string).match(/(.+):\s*(\S+)/)?.map((m: string, index: number) => index === 2 ? m.toLowerCase() : m)
    let name: string = ''
    let type: string = ''
    if (m) {
      name = m[1]
      type = m[2]
    }
    // let [ , name, type] = (fName as string).match(/(.+):\s*(\S+)/)?.map((m:string,index:number) => index===2 ? m.toLowerCase() : m); 
    if ('int|Int'.includes(type)) {
      type = 'number'
    }
    updateFields += `${name}: u.${name},
          `
    clean_snap += name + `: null,
    `
    set.add(`let ${name}El: Types.TCRInput | null = null;
  `)
    // if (ix++ < 5){
    rowList += `{row.${name}} &nbsp;`
    // }
    uiElementsStr.push(`${name}El`)
    if (name !== 'password') {
      uiSelect.add(name)
    }
    if (!fields.includes('id:string')) {
      fields.push(`
  id: null`)
    }
    if (type.includes('[]')) {
      type = 'array'
    }
    type = type.replace(/\?/g, '')
    switch (type) {
      case 'string': {
        fields.push(`
  ${name}: null`)
        if (name !== 'id') {
          partialType += `${name}: string | null
  `
        }
        break
      }
      case 'number': {
        fields.push(`
  ${name}: 0`)
        partialType += `${name}: number | null
  `
        break
      }
      case 'date': {
        fields.push(`
  ${name}: null`)
        partialType += `${name}: Date | null
  `
        break
      }
      case 'boolean': {
        fields.push(`
  ${name}: false`)
        partialType += `${name}: boolean | null
  `
        break
      }
      case 'array': {
        fields.push(`
  ${name}: []`)
        partialType += `${name}: array | []
  `
        break
      }
      case 'role': {
        fields.push(`
  ${name}: 'VISITOR'`)
        partialType += `${name}: Types.Role | null
  `
        break
      }
      default: {
        fields.push(`
  ${name}: ${type}`)
        partialType += `${name}: ${type} | null
  `
        break
      }
    }
  })
  clean_snap = clean_snap.replace(/,\s*$/, '')
  partialType = partialType.slice(0, -3) + `
}`
  updateFields = updateFields.replace(/u\.password/, "''").slice(0, -11)
  uiSelectFields = Array.from(uiSelect).join(',\n')
  theInitValues = [clean_snap, partialType, updateFields]
  variables = Array.from(set).join('')
  rowList = rowList.replace(/<\/p>/, '') + '</p>'
}


// function nullType(fName:string){
//  let [ , name, type] = fName.match(/(.+):\s*(\S+)/)?.map((m:string,index:number) => index===2 ? m.toLowerCase() : m);
// fName includes type and we added | null
//  if (type.includes('[]')){
//    return fName + ' | []';
//  }else if(!'String|Number|Boolean|Date'.includes(type)){
//    return fName + ' | null';
//  }
//}

let importTypes = 'import type {'

function createFormPage(includeTypes: string, outputChannel: any) {
  // outputChannel.appendLine('createFormPage entry point routesPath: '+ routesPath); outputChannel.show();
  const routeNamePath = path.join(routesPath, routeName_)
  if (!fs.existsSync(routeNamePath)) {
    // outputChannel.appendLine('create routeNamePath: '+ routeNamePath); outputChannel.show();
    fs.mkdirSync(routeNamePath, { recursive: true })
  }

  let inputBoxes = ''

  fields_.forEach(fName => {
    const m = (fName as string).match(/(.+):\s*(\S+)/)?.map((m: string, index: number) => index === 2 ? m.toLowerCase() : m)
    let name: string = ''
    let type: string = ''
    if (m) {
      name = m[1]
      type = m[2]
    }

    // let [ , name, type] = (fName as string).match(/(.+):\s*(\S+)/)?.map((m:string,index:number) => index===2 ? m.toLowerCase() : m);

    inputBoxes += inputBox(name, type)
  })
  let imports = ''
  embellishments_.forEach(comp => {
    imports += `import ${comp} from '$lib/components/${comp}.svelte';
  `
  })
  let cr_Activity = ''
  if (embellishments_.includes('CRActivity')) {
    cr_Activity = `<CRActivity
  PageName='${modelObjCName_}'
  bind:result
  bind:selectedUserId
  user={data.locals?.user}
  users={data.users as Types.UserPartial[]}
  ></CRActivity>`
  }

  initValues()

  let plusPageSvelte = `
<script lang="ts">
  // /${modelObjName_}/+page.svelte
  import type { Snapshot } from '../$types';
  import { onMount } from 'svelte';
  import type { PageData, ActionData } from './$types';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/state'; // for page.status code on actions
  import * as utils from '$lib/utils';
  import * as Types from '$lib/types/types';
  `
    + imports +

    `
  type ARGS = {
    data: PageData;
    form: ActionData;
  };

  let { data, form }: ARGS = $props();

  // variables bound to CRInput components
  ${variables}

  let formEl:  HTMLFormElement | null = null;
  // based on boxId document.getElementById founds them
  let uiElements: HTMLInputElement[] = [];
  // changes are not visible inside the snap's scope so we need
	// another scope to see the changes and new scope is a func snap_()
  let nullSnap = {
    ${theInitValues[0]}
  } as Types.${modelObjCName_}Partial;

  let snap = $state<Types.${modelObjCName_}Partial>(nullSnap);
  // changes not visible inside the snap's scope so we need
  // another scope to see the changes and new scope is a func snap_()
  const snap_ = () => {
    return snap;
  };

  
  // changing the id triggers updates or row items but must be
  // in effect only when uiElements[0] is docs.activeElement
  const rowSelected = async (event: MouseEvent) => {
		event.preventDefault();
		const el = event.target as HTMLParagraphElement;
    // render record list with leading record id
    let idx = el.innerText.split(' ')[0];
		let id = idIsNumeric ?  Number(idx):  String(idx);
    snap = data.${modelObjName_s}?.filter(
			(el: Types.${modelObjCName_}Partial) => el.id === id
		)[0] as Types.${modelObjCName_}Partial;
    await utils.sleep(300);
		if (uiElements && uiElements[0] && uiElements[1]) {
			uiElements[0].value = String(id);
			uiElements[1].focus();
		}	
  };

  // needed for CRActivity component
  let selectedUserId = $state(data.locals?.user.id) as string;

  let btnCreate: HTMLButtonElement;
  let btnUpdate: HTMLButtonElement;
  let btnDelete: HTMLButtonElement;
  let btnClear: HTMLButtonElement;
  let result = $state('');
  const clearMessage = () => {
    setTimeout(() => {
      result = '';
    }, 2000);
  };

  // returns status[formValid, partiallyValid], on partiallyValid we can do update
  // for Create new record full formValid with no id must be true
  let formDataValid = $derived.by(() => {
    const status = [true, false];
    if (utils.same<Types.${modelObjCName_}Partial>(snap_(), nullSnap)) return [false, false];
    for (const [key, value] of Object.entries(snap_())) {
      if ('id|updatedAt'.includes(key)) continue;
      if (value) {
        status[1] = true;
      } else {
        status[0] = false;
      }
    }
    return status;
  });

  // controls which button is visible at a moment
  let dBtnCreate = $state(true);
  let dBtnUpdate = $state(true);
  let dBtnDelete = $state(true);

  let idOK = $derived(snap.id !== null);
  $effect(() => {
		dBtnCreate = idOK || !formDataValid[0];
		dBtnUpdate = !idOK || !formDataValid[1];
		dBtnDelete = !idOK;
		if (uiElements && uiElements[0] === document.activeElement) {
      const id = (uiElements[0] as HTMLInputElement)?.value;
      if (id) {
        const sn = data.${modelObjName_s}?.filter(
          (el) => el.id === id
        )[0] as Types.${modelObjCName_}Partial;
        if (!utils.same<Types.ArticlePartial>(sn, snap)) {
					snap = sn;
				}
      }
      uiElements[0].required = dBtnCreate;  // is id required?
    }
	});

  const clearForm = (event?: MouseEvent | KeyboardEvent) => {
    event?.preventDefault();
    snap = nullSnap;
  };
  

	let spin: Types.IStringBoolean = $state({ 
    create: false, 
    update: false, 
    delete: false,
    clear: false    // TODO not need?
  });

  const enhanceSubmit: SubmitFunction = async ({ action, formData, controller, submitter }) => {
		if (submitter?.getAttribute('formaction') === '?/clear') {
			// stop the enhanced submit (chatGPT)
			controller.abort();
			formEl?.reset();
			return;
		}
    spin[action.search.slice(2)] = true; // start spinner animation

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
      
    result =
      action.search === '?/create'
      ? "creating ${modelObjName_}..."
      : action.search === '?/update'
      ? "updating ${modelObjName_}..."
      : "deleting ${modelObjName_}..."
      
    return async ({ update }) => {
      await update();
        
      if (action.search === '?/create') {
        result = page.status === 200 ? "${modelObjName_} created" : 'create failed';
      } else if (action.search === '?/update') {
        result = page.status === 200 ? "${modelObjName_} updated" : 'update failed';
      } else if (action.search === '?/delete') {
        result = page.status === 200 ? "${modelObjName_} deleted" : 'delete failed';
      }
      spin[action.search.slice(2)] = false; // stop spinner animation
      invalidateAll();
      clearForm();
      utils.hideButtonsExceptFirst([btnClear, btnCreate, btnUpdate, btnDelete]);
      clearMessage();
    }
  };
  // let owner = true;
  const color = '#4a65b6'; // spinner color
  const ${modelObjName_s}WithKey = $derived(
    data.${modelObjName_s}?.map(item => ({
        ...item,
        key: utils.sixHash()
    }))
  );
  const fetchUiElements = async () => {
		for (let i = 0; i < uiElementStr.length; i++) {
      const idEl = document.getElementByTagName()uiElements[i] as string
			uiElements[i] = document.getElementById(idEl.boxId()) as HTMLInputElement;
			await utils.sleep(200);
		}
	};
  onMount(() => {
    // 	uiElements[0] = document.getElementById(idEl.boxId()) as HTMLInputElement;
    // 	uiElements[1] = document.getElementById(nameEl.boxId()) as HTMLInputElement;
    fetchUiElements()
	});
</script>
<!-- <svelte:window onload={handleWindowLoad} /> -->
<svelte:head>
  <title>${modelObjCName_} Page</title>
</svelte:head>
${cr_Activity}

<div class='two-column-grid'>
  <div class='left-column'>
    <form action="?/create" method="post" use:enhance={enhanceSubmit} bind:this={formEl}>
      <div class='form-wrapper'>
        ${inputBoxes}
        <div class='buttons-row'>
          ${buttons}
          </div>
        </div>
      </div>
    </form>
  </div> 

  <div class='right-column' onclick={rowSelected} aria-hidden={true}>
    {#each ${modelObjName_s}WithKey as row (row.key)}
      <div class='grid-row'>
        ${rowList}
      </div>
    {/each}
  </div>

</div>

<style lang="scss">
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
		}
	}
	.two-column-grid {
		display: grid;
		width: 50vw;
		margin: 0 auto;
		grid-template-columns: 30rem 13rem;
		gap: 2rem;
		padding-bottom: 1.5rem;
	}

	.left-column {
		border: 1px solid gray;
		border-radius: 8px;
		height: 75vh;
	}
	.right-column {
		border: 1px solid gray;
		padding: 1rem;
		border-radius: 8px;
		height: calc(75vh - 2rem);
		display: grid;
		width: 100%;
		justify-content: start;
		.grid-row {
			margin: 0;
			outline: none;
			border: none;
			width: 100%;  // TODO how to make it wider as parent?
			height: 1rem !important;
			p {
				margin: 0;
				width: 100%;
				padding: 5px 0;
				&:hover {
					background-color: cornsilk;
					cursor: pointer;
				}
			}
		}
	}
</style>
`

  let plusUserSvelte = `<script lang="ts">
// ${modelObjName_}/+page.svelte
import type { Snapshot } from '../$types';
import { onMount } from 'svelte';
import type { PageData, ActionData } from './$types';
import type { SubmitFunction } from '@sveltejs/kit';
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import { page } from '$app/state'; // for page.status code on actions
import bcrypt from 'bcrypt';
import * as utils from '$lib/utils';
import * as Types from '$lib/types/types';
` + imports +

    `
type ARGS = {
  data: PageData;
  form: ActionData;
};
let { data, form }: ARGS = $props();
let formEl:  HTMLFormElement | null = null;
let uiElements: HTMLInputElement[] = [];
// variables bound to CRInput components
${variables}

let nullSnap = {
  ${theInitValues[0]}
} as Types.${modelObjCName_}Partial;

const crId_ = () => {
  return snap.id
}
// TODO what data is snap getting here it was .locals. but that could be user only not UI data
let snap = $state<Types.${modelObjCName_}Partial>(data.locals?.${modelObjName_} as Types.${modelObjCName_}Partial ?? nullSnap);
const snap_ = () => {
  return snap;
};
let selectedUserId = $state(data.locals?.user.id) as string;
const selectedUserId_ = () => {
  return selectedUserId;
}

$effect(() => {
    const selUserId = selectedUserId_();
    if (selUserId && data.users) {
      const u = data.users.filter(
        (user) => user.id === selUserId,
      )[0]; // as Types.${modelObjCName_}Partial;
      if (u) {
        snap = {
          ${theInitValues[2]}
        };
      }
    }
  });

let btnCreate: HTMLButtonElement;
let btnUpdate: HTMLButtonElement;
let btnDelete: HTMLButtonElement;
let btnClear: HTMLButtonElement;
// let iconDelete: HTMLSpanElement;
let result = $state('');
const clearMessage = () => {
  setTimeout(() => {
    result = '';
  }, 2000);
};

// returns status[formValid, partiallyValid], on partiallyValid we can do update
  // for Create new record full formValid with no id must be true
  let formDataValid = $derived.by(() => {
    const status = [true, false];
    if (utils.same<Types.${modelObjCName_}Partial>(snap_(), nullSnap)) return [false, false];
    for (const [key, value] of Object.entries(snap_())) {
      if ('id|updatedAt'.includes(key)) continue;
      if (value) {
        status[1] = true;
      } else {
        status[0] = false;
      }
    }
    return status;
  });

// control which button is visible at a moment
let dBtnCreate = $state(true);
let dBtnUpdate = $state(true);
let dBtnDelete = $state(true);

let idOK = $derived(crId_() !== null && crId_()?.length === 36);
$effect(() => {
  dBtnCreate = idOK || !formDataValid[0];
  dBtnUpdate = !idOK || !formDataValid[1];
  dBtnDelete = !idOK;
  if (uiElements && uiElements[0] === document.activeElement) {
    const id = (uiElements[0] as HTMLInputElement)?.value;
    if (id) {
      const sn = data.${modelObjName_s}?.filter(
        (el) => el.id === id
      )[0] as Types.${modelObjCName_}Partial;
      if (!utils.same<Types.${modelObjCName_}Partial>(sn, snap)) {
        snap = sn;
      }
    }
    uiElements[0].required = dBtnCreate;  // is id required?
  }
});

let spin: Types.IStringBoolean = $state({ 
  create: false, 
  update: false, 
  delete: false,
  clear: false    // TODO not need?
});

const clearForm = (event?: MouseEvent | KeyboardEvent) => {
  event?.preventDefault();
  snap = nullSnap;
  utils.hideButtonsExceptFirst([btnCreate, btnUpdate, btnDelete]);
};
  
const enhanceSubmit: SubmitFunction = async ({ action, formData, controller, submitter }) => {
  if (submitter?.getAttribute('formaction') === '?/clear') {
    // stop the enhanced submit (chatGPT)
    controller.abort();
    formEl?.reset();
    return;
  }
  spin[action.search.slice(2)] = true; // start spinner animation

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
    
  result =
    action.search === '?/create'
    ? "creating ${modelObjName_}..."
    : action.search === '?/update'
    ? "updating ${modelObjName_}..."
    : "deleting ${modelObjName_}...";
  if (action.search === '?/delete') {
    utils.hideButtonsExceptFirst([btnDelete, btnCreate, btnUpdate]);
  }
    
  return async ({ update }) => {
    await update();
      
    if (action.search === '?/create') {
      result = page.status === 200 ? "${modelObjName_} created" : 'create failed';
    } else if (action.search === '?/update') {
      result = page.status === 200 ? "${modelObjName_} updated" : 'update failed';
    } else if (action.search === '?/delete') {
      result = page.status === 200 ? "${modelObjName_} deleted" : 'delete failed';
      // iconDelete.classList.toggle('hidden');
      utils.hideButtonsExceptFirst([btnCreate, btnUpdate, btnDelete]);
    }
    spin[action.search.slice(2)] = false; // stop spinner animation
    invalidateAll();
    await utils.sleep(1000);
    clearForm();
    utils.hideButtonsExceptFirst([btnCreate, btnUpdate, btnDelete]);
    clearMessage();
  }

}
// let owner = true;
const color = '#4a65b6';  // spinner color

const fetchUiElements = async () => {
		for (let i = 0; i < uiElement.length; i++) {
				uiElements[0] = document.getElementById(idEl.boxId()) as HTMLInputElement;
				uiElements[1] = document.getElementById(nameEl.boxId()) as HTMLInputElement;
			// if (uiElements[0] && uiElements[1]) break;
			await utils.sleep(200);
		}
	};
  // onMount(() => {
    // 	uiElements[0] = document.getElementById(idEl.boxId()) as HTMLInputElement;
    // 	uiElements[1] = document.getElementById(nameEl.boxId()) as HTMLInputElement;
    fetchUiElements()
	});
</script>
<svelte:head>
  <title>${modelObjCName_} Page</title>
</svelte:head>
${cr_Activity}

<div class="two-column-grid">
	<div class="left-column">
    <form action="?/create" method="post" use:enhance={enhanceSubmit}  bind:this={formEl}>
      <div class='form-wrapper'>
        ${inputBoxes}
        <div class='buttons-row'>
          ${buttons}
          </div>
        </div>
      </div>
    </form>
  </div>
  <div class="right-column" onclick={rowSelected} aria-hidden={true}>
		<!-- argument true to return an array not a string -->
		{#each data.${modelObjName_s}WithKey as row (row.key)}
			<div class="grid-row">
				<p id={row.key}>{row.id}: {row.name}</p>
			</div>
		{/each}
	</div>
</div>
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
  .two-column-grid {
		display: grid;
		width: 90vw;
		grid-template-columns: 1fr 1.5fr;
		column-gap: 1rem;
	}
	.grid-row {
		padding: 0 1rem;
		margin: 0;
		outline: none;
		border: none;
		height: 1.2rem;
		line-height: 2rem;
		p {
			padding: 0 1rem 0 2rem;
			&:hover {
				background-color: cornsilk;
				cursor: pointer;
			}
			height: 1.6rem;
		}
	}
	.left-column {
		border: 1px solid gray;
		border-radius: 8px;
		height: 75vh;
	}
	.right-column {
		height: 75vh;
		display: grid;
		justify-content: start;
	}
  CRTooltip:has(> span) {
    display: flex;
    align-items: baseline;
  }
</style>
`

  const pageSveltePath = path.join(routeNamePath, '/+page.svelte')
  if (modelObjCName_ === 'User') {
    fs.writeFileSync(pageSveltePath, plusUserSvelte, 'utf-8')
  } else {
    fs.writeFileSync(pageSveltePath, plusPageSvelte, 'utf-8')
  }
}

function createCRInput() {
  const componentsPath = ensureComponentPath()
  if (!componentsPath) {
    return
  }
  const crInput = `<script lang="ts">
	//  components/CRInput.svelte
	import { browser } from '$app/environment';
	import * as utils from '$lib/utils';
	import { onMount } from 'svelte';
	type TExportValueOn = 'keypress' | 'keypress|blur' | 'enter' | 'blur' | 'enter|blur';

	export type TValueLabelArr = Array<[value: string, label: string]>;
	export type TRadioGroup = {
		valueLabelArr?: TValueLabelArr;
		groupValue?: string;
	};
	type PROPS = {
		title: string;
		width?: string;
		height?: string;
		fontsize?: string;
		margin?: string;
		checked?: boolean;
		name?: string;
		radioGroup: TValueLabelArr;
		groupValue: string | number;
		type?:
			| string
			| number
			| Date
			| boolean
			| password
			| time
			| text
			| tel
			| range
			| radio
			| checkbox
			| textarea;
		rows?: string;
		cols?: string;
		value?: string | number | boolean | Date;
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
		checked = $bindable(false),
		name = '',
		radioGroup = [],
		groupValue = $bindable(),
		type = 'text',
		rows = '6',
		cols = '30',
		value = $bindable(),
		required = false,
		err = undefined,
		onButtonNext,
		exportValueOn = 'enter',
		onInputIsReadyCallback = undefined,
		capitalize = false,
		clearOnInputIsReady = false
	}: PROPS = $props();


  let elId = utils.sixHash();
  const labelUp = 'opacity:1;top:3px;z-index:10;';
	const labelDown = 'opacity:0.5;top:25px;z-index:10;';

  // words separated by space or underscore
	export const capitalizes = (str: string) => {
		str = str.replace(/_/gm, ' ').trim();
		let s = (str[0] as string)?.toUpperCase() + str.slice(1);
		return s.replace(/\b[a-z](?=[a-z]{2})/g, (char: string) => char.toUpperCase());
	};

	String.prototype.capitalizes = function () {
		return capitalizes(this);
	};
	// NOTE: enter non breaking unicode space:
	// Press Ctrl+Shift+U, type 00a0, and then press Enter or Space.
	// here we held between apostrophes three non breaking spaces
	title = '  ' + capitalizes(title) + '  ';
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

	const onFocusHandler = (event: FocusEvent) => {
		event.preventDefault();
		labelStyle = labelUp;;
	};

	const onBlurHandler = (event: FocusEvent) => {
		event.preventDefault();

		// no entry yet so no export is ready buy is dirty -- only handle placeholder if entry is required
		if (value === '') {
			// input is required so warn the user with pink placeholder required message
			if (required) {
				inputEl.placeholder = requiredStr;
				labelStyle = labelUp;
				utils.setPlaceholderColor('pink');
			} else {
				// input is not required so lower down field label inside the input box
				labelStyle = labelDown;
			}
		}
    if (capitalize) {
			value = utils.capitalize(value as string);
		}
		if (exportValueOn.includes('blur')) {
			if (onInputIsReadyCallback) {
				onInputIsReadyCallback();
			}
		}
	};
	const onKeyUpHandler = (event: KeyboardEvent) => {
		event.preventDefault();
    labelStyle = labelUp;
		if (event.key === 'Tab') return;

		if (value && (value as string).length > 0) {
			if (
				exportValueOn.includes('keypress') ||
				(exportValueOn.includes('enter') && event.key === 'Enter')
			) {
        value = capitalizes(value as string);
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
	let labelStyle = $state(labelDown);
	let label: HTMLLabelElement;
	let inputEl: HTMLInputElement | HTMLTextAreaElement;
  // in order to compare inputEl with document.activeElement
  // document.getElementById(inputEl.boxId()) gets wrapped input box
  // otherwise idEl is a wrapper reference newer equal to doc.activeElement
  export const boxId = () => {
		return inputEl.id;
	};

	export const getInputBoxValue = () => {
		return typeof value === 'number' ? Number(inputEl.value) : String(inputEl.value);
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

  export const setFocus = () => {
		labelStyle = value && required ? labelUp : labelDown;
	};

	$effect(() => {
		if (required) {
      inputEl.removeAttribute('required');
    } else {
      inputEl.setAttribute('required', 'true');
		}
    labelStyle = value ? labelUp : labelDown;
	});

	onMount(() => {
		label = document.getElementsByTagName('label')[0] as HTMLLabelElement;
		if (required) {
			inputEl.setAttribute('required', 'true');
		} else {
			inputEl.removeAttribute('required');
		}
	});
</script>

<div class="input-wrapper" style="margin:{margin};">
	{#if type === 'textarea'}
		<textarea
			id={elId}
			bind:this={inputEl}
			rows={Number(rows)}
			cols={Number(cols)}
			required
			bind:value
			onkeyup={onKeyUpHandler}
			onfocus={onFocusHandler}
			onblur={onBlurHandler}
			disabled={false}
		>
		</textarea>
  {:else if 'checkbox' === type}
    <input type="checkbox" required bind:checked />
    <p>checked {checked}</p>
  {:else if radioGroup.length}
    <div class="radio-block">
      {#each radioGroup as [value, label], index (index)}
        <input class="radio-button" type="radio" id={value} bind:group={groupValue} {value} />
        <label for={value}> {label} </label>
      {/each}
    </div>
	{:else}
		<input
			id={elId}
			bind:this={inputEl}
			type={type ? type : 'text'}
			required
			bind:value
			onkeyup={onKeyUpHandler}
			onfocus={onFocusHandler}
			onblur={onBlurHandler}
			disabled={false}
		/>
	{/if}
	<label for={elId} onclick={setFocus} aria-hidden={true} style={\`\${labelStyle}\`}>
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
		--INPUT-COMRUNNER-HEIGHT: 2rem !important;
		--INPUT-COMRUNNER-FONT-SIZE: 16px;
		// --BACKGROUND-COLOR: white;
	}

	.input-wrapper {
		position: relative;
		width: max-content;
		/* adjust label to look like placeholder */
		padding-top: 0.8rem;
		label {
			position: absolute;
			left: 15px;
			font-size: var(--INPUT-COMRUNNER-FONT-SIZE);
			color: var(--INPUT-COLOR);
			background-color: var(--BACKGROUND-COLOR);
			transition: 0.5s;
		}
		textarea {
			outline: none;
			background-color: var(--BACKGROUND-COLOR);
			border: 1px solid gray;
		}
		input {
			display: inline-block;
			font-size: var(--INPUT-COMRUNNER-FONT-SIZE);
			padding: 0 10px;
			margin: 0;
			outline: none;
			color: var(--TEXT-COLOR);
			border: 1px solid gray;
			background-color: var(--BACKGROUND-COLOR);
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
  .radio-block {
		display: grid;
		grid-template-columns: 1rem 16rem;
		label {
			margin-left: 0.5rem;
			&:hover {
				cursor: pointer;
				color: blue;
			}
		}
	}
	.err {
		color: pink;
		/* when placeholder moves on top it makes space on the right of 0.2rem*/
		padding: 1px 0.2rem;
	}
</style>
`
  const crInputPath = path.join(componentsPath, 'CRInput.svelte')
  fs.writeFileSync(crInputPath, crInput, 'utf-8')
}

function createCRSpinner() {
  const componentsPath = ensureComponentPath()
  if (!componentsPath) {
    return
  }
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
  fs.writeFileSync(crSpinnerPath, crSpinner, 'utf-8')
}

function createCRActivity() {
  const componentsPath = ensureComponentPath()
  if (!componentsPath) {
    return
  }
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
  let msgEl: HTMLSpanElement;
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
  {#if user?.role === 'ADMIN' && users && users.length > 1}
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
      <div bind:this={msgEl} class="message">{showResult()}</div>
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
  fs.writeFileSync(crActivityPath, crActivity, 'utf-8')
}

function createCRTooltip() {
  const componentsPath = ensureComponentPath()
  if (!componentsPath) {
    return
  }
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
  import * as utils from '$lib/utils';

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
    const m = getComputedStyle(node).transform.match(/scale(([0-9.]+))/);
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


  const hoveringId = 'hovering-' + utils.sixHash();
  // as caption and panel are mutually exclusive
  // even when both are received via $props()
  // we use the same tooltipPanelId for both
  // const tooltipPanelId = 'tooltip-' + utils.sixHash();
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
    return preferredPos.replace(/s+/g, '').split(',') as string[];
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
  fs.writeFileSync(crTooltipPath, crTooltip, 'utf-8')
}

function createSummaryDetail() {
  const componentsPath = ensureComponentPath()
  if (!componentsPath) {
    return
  }
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
  fs.writeFileSync(crSummaryDetailPath, crSummaryDetail, 'utf-8')
}

async function findPrismaSchemaRoot(): Promise<string | null> {
  const workspaceFolders = vscode.workspace.workspaceFolders
  if (!workspaceFolders?.length) {
    return null // No workspace open
  }

  for (const folder of workspaceFolders) {
    let currentPath = folder.uri.fsPath

    while (true) {
      const prismaSchemaPath = path.join(currentPath, "prisma", "schema.prisma")

      if (fs.existsSync(prismaSchemaPath)) {
        return currentPath // ✅ Found root containing prisma/schema.prisma
      }

      if (currentPath === rootPath) {
        break // reached project root, stop
      }
      // Walk up to parent folder
      const parentPath = path.dirname(currentPath)
      currentPath = parentPath
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
  )
}

// fieldInfo is a line following field names
type FieldInfo = {
  type: string
  prismaAttrs: string // everything after the type
}

// every model/table has fieldName  and fieldInfo
type ModelInfo = {
  fields: {
    [fieldName: string]: FieldInfo
  }
  modelAttributes: string[] // e.g. ["@@map(\"users\")", "@@index([email])"]
}

// there are many models/tables in schema.prisma
type SchemaModels = {
  [modelName: string]: ModelInfo
}


let strModelNames = '|'

function parsePrismaSchema(schemaContent: string): SchemaModels {
  const models: SchemaModels = {}
  const modelRegex = /model\s+(\w+)\s*{([^}]*)}/gms

  let modelMatch
  while ((modelMatch = modelRegex.exec(schemaContent)) !== null) {
    const [, modelName, body] = modelMatch
    const fields: Record<string, FieldInfo> = {}
    const modelAttributes: string[] = []

    // Remove block comments first
    let bodyWithoutBlocks = body.replace(/\/\*[\s\S]*?\*\//g, "")

    const lines = bodyWithoutBlocks
      .split("\n")
      .map((line) => line.trim().replace(/\s{2,}|\t/gm, ' '))
      .filter(Boolean)

    for (const line of lines) {
      if (line.startsWith("//")) {
        continue // skip single-line comment
      }

      if (line.startsWith("@@")) {
        modelAttributes.push(line)
        continue
      }

      const [fieldName, fieldType, ...rest] = line.split(/\s+/)
      if (!fieldName || !fieldType) {
        continue
      }

      fields[fieldName] = {
        type: fieldType,
        prismaAttrs: rest.join(" "),
      }
    }

    models[modelName] = {
      fields: sortObjectKeys(fields),
      modelAttributes,
    }
  }

  /* 
    This function returns models as SchemaModels so use it to populate above Models
    for data entry fields avoid fieldNames that are
    models itself like Todo, Profile, containing @@ chars 
    and some of @unique, @default, @default(now(), modelName), @relation
  */
  // make a string-list of modelNames like '|Todo|User|Profile|'
  for (const [modelName, theFields] of Object.entries(models)) {
    strModelNames += modelName + '|'
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
    for (let [fieldName, { type, prismaAttrs }] of Object.entries(fields)) {
      if ('0|1'.includes(fieldName)) {
        continue
      }
      // type could be optional, so remove ? if any as it cannot match model name
      type = type.replace(/\?/g, '')
      if (fieldName.includes('password')) {  // passwordHash or similar
        fieldName = 'password'
      }
      if (type === 'DateTime') {
        type = 'Date'
      }
      // exclude this field names
      const pattern = '@default\\((' + strModelNames + 'now\\(\\))\\)'
      let regex = new RegExp(pattern)
      let m = prismaAttrs.match(regex)   // null if failed
      if (m && m[1]) {
        continue               // not data entry field name
      }

      // type cannot be a model name like Profile...
      regex = new RegExp('(' + strModelNames.slice(1, -1) + ')')
      m = type.match(regex)   // null if failed
      if (m && m[1]) {
        continue
      }

      m = prismaAttrs.match(/(@unique|@createdAt)/)  // non-mutable
      if (m && m[1]) {
        continue
      }

      const hasBrackets = type.includes('[]')
      const hasId = prismaAttrs.includes('@id')
      const hasRole = type === 'Role'
      const include = !hasBrackets || hasId || hasRole
      if (include) {
        arrFields.push(fieldName + ': ' + type)
      }
    }
    try {
      modelsFieldNames[modelName] = arrFields
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log('cannot add a model' + msg)
    }
  }

  return models
}



export async function activate(context: vscode.ExtensionContext) {

  const workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined = vscode.workspace.workspaceFolders
  // const defaultFolderPath: string = '/home/mili/TEST/cr-crud-extension';
  rootPath = await execShell('pwd')
  rootPath = rootPath.replace(/\n$/, '')
  pendingFile = path.join(rootPath, '/prisma/installPartTwo.pending')
  routesPath = path.join(rootPath, '/src//routes/')
  sudoName_ = await execShell('whoami')
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
  const outputChannel = vscode.window.createOutputChannel('WebView Logs')

  const prismaSchemaRoot = await findPrismaSchemaRoot()
  if (!prismaSchemaRoot) {
    noPrismaSchema = true
  }

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
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    )

    let includeTypes = ''
    if (noPrismaSchema) {
      vscode.window.showInformationMessage('EXT: NO PRISMA SCHEMA FOUND')
    }
    // vscode.window.showInformationMessage('EXT: rootPath == '+ rootPath),
    // const nonce = getNonce();
    panel.webview.html = getWebviewContent(panel.webview, context.extensionUri, noPrismaSchema, installPartTwoPending, sudoName_)

    fs.writeFileSync(path.join(rootPath, '/src/currentWebview.html'), panel.webview.html)
    panel.webview.onDidReceiveMessage(async (msg) => {

      if (msg.command === 'setDbAndOwner') {
        db_ = msg.payload
        vscode.window.showInformationMessage('db/owner params ' + JSON.stringify(db_))
        if (db_.name && db_.owner && db_.password) {
          const content = db_.host + ':' + db_.port + ':' + db_.name + ':' + db_.owner + ':' + db_.password
          fs.writeFileSync(pgPassPath, content, {
            encoding: 'utf-8',
            mode: 0o600   // Very important for .pgpass! PostgreSQL requires 0600
          })
        }
      }
      else if (msg.command === 'installPrismaPartOne') {
        // vscode.window.showInformationMessage('rootPath is ' + rootPath)
        // outputChannel.appendLine('installPrismaPartOne'+ JSON.stringify(db_)); outputChannel.show();
        // db_ = JSON.parse(msg.db);     // db.name, db.owner, db.password
        const pm = detectPackageManager()
        if (typeof pm === 'object') {
          vscode.window.showInformationMessage('detectPackageManager err:' + pm.err)
        } else {
          xPackageManager(pm)
        }
        sendToTerminal(`cd ${rootPath}`)
        // outputChannel.appendLine('sendToTerminal cd rootPath'); outputChannel.show()
        sendToTerminal(`${pm} install bcrypt @types/bcrypt @prisma/client; ${pm} install typescript ts-node @types/node globals -D; ${pm} i -D prisma ; ${ex} prisma init --datasource-provider postgresql`)
        const prismaPath = path.join(rootPath, '/prisma/schema.prisma')
        // installation is in progress so wait to see that schema.prisma is installed
        for (let i = 0; i < 30; i++) {
          await sleep(1000)
          if (fs.existsSync(prismaPath)) {
            break
          }
        }
        await sleep(1000)  // to be sure it is completed
        createPendingFile()


        // await sleep(1000)
        // panel.dispose()

        // read created /prisma/schema.prisma and display it in a new Tab
        try {
          // Get workspace root (assume first folder)
          const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
          if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder open')
            // TODO send to output how to make a Workspace
            return
          }

          // Construct absolute file path
          const schemaPath = path.join(workspaceFolder.uri.fsPath, '/prisma/schema.prisma')
          if (!fs.existsSync(schemaPath)) {
            fs.writeFileSync(schemaPath, '', 'utf-8')
          }
          fs.appendFileSync(schemaPath, schemaWhatToDo, 'utf-8')
          // Create path for the file
          let uri = vscode.Uri.file(schemaPath)
          // Open in a new tab (beside current editor)
          await vscode.window.showTextDocument(uri, {
            viewColumn: vscode.ViewColumn.Beside, // Opens beside active editor
            preview: false // Optional: Force a new tab (not preview mode)
          })

          const envPath = path.join(rootPath, '/.env')
          uri = vscode.Uri.file(envPath)

          const dblink = `DATABASE_URL=postgresql://${db_.owner}:${db_.password}@localhost:${db_.port}/${db_.name}?schema=public`
          fs.writeFileSync(envPath, dblink, 'utf-8')

          await vscode.window.showTextDocument(uri, {
            viewColumn: vscode.ViewColumn.Beside, // Opens beside active editor
            preview: false // Optional: Force a new tab (not preview mode)
          })

        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          // Handle errors (e.g., file not found)
          console.error('Failed to open file:', err)
          panel.webview.postMessage({
            command: 'fileError',
            error: (err as Error).message
          })
        }
        panel.webview.postMessage({
          command: "installPartOneDone"
        })
      }
      else if (msg.command === 'installPrismaPartTwo') {
        // if user did not supplied db_ details read them from .env if any
        let psqlConnect = ''
        if (!(db_.name || db_.owner || db_.password)) {
          try {
            const envPath = path.join(rootPath as string, '.env')
            const connStr = fs.readFileSync(envPath, 'utf-8')
            const [, dbowner, dbpassword, host, port, dbname] = 'postgresql://rony:rony@localhost:5432/ronydb?schema=public'.match(/\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([-a-zA-Z_0-9]+)/) as string[]

            const db_: IStrKeyStrVal = { name: dbname, owner: dbowner, password: dbpassword, host: host, port: port }
            psqlConnect = `psql -h ${host} -U ${dbowner} -d postgres -p ${port}`
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err)
            vscode.window.showErrorMessage('Handling .pgpass permission err: ' + msg)
          }
        }

        let sql = `psql -X -v ON_ERROR_STOP=1 <<'EOF'
-- Create the role if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '$DBOWNER') THEN
    BEGIN
      CREATE ROLE "$DBOWNER" LOGIN CREATEDB;
    EXCEPTION WHEN duplicate_object THEN  -- SQLSTATE '42710'
      RAISE NOTICE 'Role % already exists (created concurrently)', '$DBOWNER';
    END;
  END IF;
END
$$; 
-- Change the role's password (optional, only if you want it to match '$DBPASSWORD')
ALTER ROLE "\$DBOWNER" WITH ENCRYPTED PASSWORD '\$DBPASSWORD';

-- Create the database if it doesn't exist, owned by \$DBOWNER
CREATE DATABASE "\$DBNAME" OWNER "\$DBOWNER" ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0;

-- Connect to the new database and give the owner full rights (usually already true, but explicit)

\\c "\$DBNAME"

GRANT ALL PRIVILEGES ON DATABASE "\$DBNAME" TO "\$DBOWNER";
REVOKE CONNECT ON DATABASE "\$DBNAME" FROM PUBLIC;        -- optional: disallow public connect
GRANT CONNECT ON DATABASE "\$DBNAME" TO "\$DBOWNER";

EOF`.replace(/\$DBNAME/mg, `${db_.name}`)
          .replace(/\$DBOWNER/mg, `${db_.owner}`)
          .replace(/\$DBPASSWORD/mg, `${db_.password}`)
          .replace(/\$HOST/mg, `${db_.host}`)
          .replace(/\$PORT/mg, `${db_.port}`)

        sendToTerminal(sql)

        await sleep(2000)
        sendToTerminal(`${ex} prisma migrate dev --name init; ${ex} prisma generate`)

        deletePendingFile()

        panel.webview.postMessage({
          command: "installPartTwoDone"
        })
      }
      else if (msg.command === 'readSchema') {
        try {

          const prismaSchemaPath = path.join(rootPath as string, "prisma", "schema.prisma")
          const schemaContent = fs.readFileSync(prismaSchemaPath, "utf-8")

          const parsedSchema = parsePrismaSchema(schemaContent)
          try {
            if (!modelsFieldNames) {
              outputChannel.appendLine('modelsFieldNames NOT found'); outputChannel.show()
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err)
            outputChannel.appendLine('No modelsFieldNames found ' + msg); outputChannel.show()
          }
          // TODO: parse schemaContent and send back to WebView
          // outputChannel.appendLine('parsedSchema\n' + JSON.stringify(parsedSchema, null, 2)); outputChannel.show()
          panel.webview.postMessage({
            command: "renderSchema",
            payload: parsedSchema,
            rootPath: rootPath,
            modelsFieldNames,
          })
          // vscode.window.showErrorMessage('This is a test vscode.window.showErrorMessage');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          vscode.window.showErrorMessage(
            `Failed to read schema: ${msg}`
          )
        }
        // clean .gitignore from repeted lines /src/generated/prisma
        const gitIgnorePath = path.join(routesPath, '.gitignore')
        if (fs.existsSync(gitIgnorePath)) {
          let gi = fs.readFileSync(gitIgnorePath, "utf-8")
          gi = gi.replace(/\/src\/generated\/prisma/gm, '').replace(/^\n/gm, '') + '/src/generated/prisma'
          fs.writeFileSync(gitIgnorePath, gi, "utf-8")
        }
      }
      else if (msg.command === 'renderORMFields') {
        outputChannel.appendLine('renderORMFields called target: ' + msg.target); outputChannel.show()
        panel.webview.postMessage({
          command: "ORMFieldsSent",
          target: msg.target,
          markup: `<p style='color:green;'>Webview Extension renders using msgEl reference</p>
          <p style='color:green;'>Webview Extension renders using msgEl reference</p>
          <p style='color:green;'>Webview Extension renders using msgEl reference</p>
          <p style='color:green;'>Webview Extension renders using msgEl reference</p>
          `
        })
      }
      else if (msg.command === 'createCrudSupport') {
        // outputChannel.appendLine('HTML call createCrudSupport'); outputChannel.show();
        const { routeName, modelObjName, fields, inputBoxWidth, embellishments } = msg.payload as {
          routeName: string
          modelObjName: string
          fields: string[]
          inputBoxWidth: string,
          embellishments: string[]
        }
        inputBoxWidth_ = inputBoxWidth
        const pageSveltePath = path.join(routesPath, routeName, '/+page.svelte')
        // outputChannel.appendLine('createCrudSupport fields: '+ JSON.stringify(fields)); outputChannel.show();
        if (fs.existsSync(pageSveltePath)) {
          const answer = await vscode.window.showWarningMessage(
            `There is a route ${routeName}. To overwrite it?`,
            { modal: true },
            'Yes',
            'No'
          )
          if (answer === 'No') {
            return
          }
        }
        type FuncList = {
          [funcName: string]: Function
        }
        routeName_ = routeName
        modelObjName_ = modelObjName.toLowerCase()
        modelObjName_s = modelObjName_.trim().replace(/(.)$/, (c) => c === 'y' ? 'ies' : c + 's')
        modelObjCName_ = modelObjName  //[0].toUpperCase() + modelObjName.slice(1);
        fields_ = fields.join().replace(/Int|int/g, 'number').replace(/:\s*?(\w+)/g, match => match.toLowerCase()).split(',')
        fields_ = sortArrByOrdered(fields_ as string[]) as string[]
        // outputChannel.appendLine('fields_: ' + JSON.stringify(fields_,null,2));outputChannel.show();

        embellishments_ = embellishments
        // createUtils(routeName, fields);
        const funcList: FuncList = {
          'CRInput': createCRInput,
          'CRSpinner': createCRSpinner,
          'CRActivity': createCRActivity,
          'CRTooltip': createCRTooltip,
          'CRSummaryDetail': createSummaryDetail,
        }
        //  Object.values are function  references that create a specific page
        //  and are executed based on the embellishments content picking the
        // reference from the funcList above
        for (const fun of Object.values(embellishments)) {
          try {
            funcList[fun]() // call the function reference
          } finally { }
        }
        spinners_()
        createFormPage(includeTypes, outputChannel)

        // create accompanying +page.server.ts file
        const pageServerPath = path.join(routesPath, routeName_, '/+page.server.ts')
        fs.writeFileSync(pageServerPath, getServerPage(), 'utf-8')

        const hooksPath = path.join(rootPath, '/src/hooks.server.ts')
        fs.writeFileSync(hooksPath, getHooksPage(), 'utf-8')

        const exportDbPath = path.join(rootPath, '/src/lib/server/db.ts')
        fs.writeFileSync(exportDbPath, getPrismaClient())
        panel.webview.postMessage({
          command: "createCrudSupportDone"
        })
        // outputChannel.appendLine(`[WebView] createCrudSupport DONE`);outputChannel.show(true);

        panel.webview.postMessage({
          command: "enableRemoveHint",
        })
      }
      else if (msg.command === 'saveTypes') {
        // outputChannel.appendLine('types '+ JSON.stringify(msg.payload.types,null,2)); outputChannel.show();
        const dbPath = path.join(rootPath as string, '/src/lib/server/')
        if (!fs.existsSync(dbPath)) {
          fs.mkdirSync(dbPath, { recursive: true })
        }
        try {
          const exportDbPath = path.join(dbPath, '/db.ts')
          if (!fs.existsSync(exportDbPath)) {
            fs.writeFileSync(exportDbPath, `import { PrismaClient } from '@prisma/client';

  // export const db = new PrismaClient();
  export const db = new PrismaClient({
    log: ['warn', 'error']
  });
  // log: ['query', 'info', 'warn', 'error']`
            )
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          outputChannel.appendLine('createDBExportFile err: ' + msg); outputChannel.show()
        }

        // BEGINNING /src/lib/utils index.ts and helpers.ts

        const utilsPath = path.join(rootPath as string, '/src/lib/utils/')
        if (!fs.existsSync(utilsPath)) {
          fs.mkdirSync(utilsPath, { recursive: true })
        }

        const helpersPage = path.join(utilsPath as string, '/helpers.ts')
        if (!fs.existsSync(helpersPage)) {
          fs.writeFileSync(helpersPage, getHelpersPage())
        }

        const indexPage = path.join(utilsPath, '/index.ts')
        if (!fs.existsSync(indexPage)) {
          fs.writeFileSync(indexPage, `
    export * from './helpers'
`
          )
        }

        // END /src/lib/utils index.ts and helpers.ts

        const appTypesPath = path.join(rootPath as string, '/src/lib/types/')
        if (!fs.existsSync(appTypesPath)) {
          fs.mkdirSync(appTypesPath, { recursive: true })
        }
        lowerCaseTypes = msg.payload.types
          .replace(/(String|Number|Boolean)/gm, (s: string) => s.toLowerCase())
          .replace(/DateTime/gm, 'Date')
          .replace(/\bInt\b/gi, 'number').replace(/\?/g, '')
        // outputChannel.appendLine(lowerCaseTypes); outputChannel.show();
        // outputChannel.appendLine(msg.payload.includeTypes); outputChannel.show();
        // includeTypes = msg.includeTypes;
        // vscode.window.showInformationMessage(includeTypes)
        let types = `
  // CRAppTypes from schema.prisma
  export type Role = 'USER' | 'ADMIN' | 'VISITOR' | 'MODERATOR';
  ${lowerCaseTypes}
  // Copy this import to CRUD +page.svelte files
  // ${msg.payload.includeTypes}
`
        // outputChannel.appendLine('lowerCaseTypes'+ JSON.stringify(lowerCaseTypes)); outputChannel.show();
        let partialTypes = getPartialTypes()
        createSelectBlocks(partialTypes)
        // outputChannel.appendLine(partialTypes); outputChannel.show();
        types += partialTypes
        const appTypeFilePath = path.join(appTypesPath, 'types.ts')
        fs.writeFileSync(appTypeFilePath, types, 'utf-8')

      }
      else if (msg.command === 'log') {
        // vscode.window.showInformationMessage(`Bane command log ${msg.text}`);
        vscode.window.showInformationMessage(`log ${msg.text}`)
        // log should have at least a text property
        // Or log to output channel
        outputChannel.appendLine(`[WebView log outputChannel ${msg.text}] `); outputChannel.show(true) // false = don't preserve focus
        if (msg.target) {
          outputChannel.appendLine('log got the target: ' + msg.target); outputChannel.show()
          // msg.target.innerHTML += `<p style='color:green;'>Webview Extension renders using msgEl reference</p>`
        }
      }
      else if (msg.command === 'cancel') {
        panel.dispose()
      }
    })
  })

  context.subscriptions.push(disposable)
}

function getWebviewContent(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  noPrismaSchema: boolean,
  installPartTwoPending: boolean,
  sudoName_: string
): string {

  // Enable scripts in the webview
  webview.options = {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
  }

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
      width: 100%;
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
    .dbname-block {
      display: grid;
      grid-template-columns: repeat(3, 12rem);
      column-gap: 0.2rem;
      margin: 0;
      padding: 0;

      label {
        width: 10rem;
        padding: 0;
        margin: 0 1rem 6px 0;
      }

      input {
        width: 11rem;
        margin: 0;
        padding: 3px 0 3px 0.5rem !important;
        border: 1px solid lightgray;
        border-radius: 3px;

        &:focus {
          outline: 1px solid skyblue;
        }
      }
    }
  </style>

</head>
<body>
<div>
  <h2 style='margin-left:8rem;'>Create CRUD Support</h2>

  <pre id='installPartOneId' class='hidden'>
      <h3>Prisma Installation Part One</h3>
The Extension 'Create CRUD Form Support' found that Prisma ORM is not installed 
in your project and it can help with installing it. In this the first part of the 
installation it will add all the necessary packages and instantiate Prisma in this 
project installing a very basic schema in /prisma/schema.prisma file at the project
root.

  <div class="dbname-block">
    <label for='dbNameId'>
      Database Name
      <br /><input id='dbNameId' type='text' placeholder='avoid dashes in name' />
    </label>
    <label for='dbOwnerId'>
      Database Owner
      <br /><input id='dbOwnerId' type='text' value="${sudoName_}"/>
    </label>
    <label for='dbOwnerPasswordId'>
      Owner's Password
      <br /><input id='dbOwnerPasswordId' type='password' />
    </label>
    <label for='dbHostId'>
      Host Name
      <br /><input id='dbHostId' type='string' value='localhost'/>
    </label>
    <label for='dbPortId'>
      Communication Port
      <br /><input id='dbPortId' type='number' value='5432'/>
    </label>
  </div>

  By specifying database name, database owner name and owner's password the Extension
will set the database connection string in the .env file and install with no interaptions, 
otherwise you should set it yourself and the process will ask for them latter on.
  It will open schema.prisma and .env contents in separate windows and a continue button 
waiting for you to 
  1)  Specify your Prisma models/tables replacing the current schema.prisma content.
  2)  Specify the connection string in the opened .env file if not set by the Extension.
When you are done select the continue button to finish the installation.
  If you would like to close the Extension in order to finish the above tasks you could
after that restart the Extension again and it will display the commands that you should
enter yourself or to select the continue button to allow the Extension to finish the 
installation

<button id='installPartOneBtnId'>Install Prisma ORM</button><button id='cancelPartOneBtnId'>Cancel</button>
  </pre>

  <pre id='installPartTwoId' class='hidden'>
          <h3>Prisma Installation Part Two</h3>
We assume that you finished below tasks
  1)  Ctrl + double-click on .env file to open it beside this Extension and
      enter valid connection string and save the file
  2)  Ctrl + double-click on /prisma/schema.prisma to open it beside the Extension
      and prepare schema models/tables
      Use model abilities for setting defaults, generating Ids,...
      Save the model.
Selecting the continue button the extension  will issue the final commands for installing 
Prisma, otherwise you can enter yourself the following commands

  sudo dropdb --if-exists -U "$DBOWNER" "$DBNAME" || true
  sudo -u postgres psql -c "DROP DATABASE IF EXISTS $DBNAME;"
  sudo -u postgres createdb "$DBNAME" -O "$DBOWNER"
  sudo -u postgres psql -d "$DBNAME" -c "GRANT ALL ON SCHEMA public TO $DBOWNER; GRANT CONNECT ON DATABASE $DBNAME TO $DBOWNER;"
  sudo -u postgres psql -d "$DBNAME" -c"GRANT ALL PRIVILEGES ON SCHEMA public TO $DBOWNER; ALTER SCHEMA public OWNER TO $DBOWNER; ALTER DATABASE dbtest OWNER TO $DBOWNER;"
  sudo -u postgres psql -d "$DBNAME" -c"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO $DBOWNER; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO $DBOWNER;"

  pnpx prisma migrate dev --name init		# create first migration (when ready)"
  pnpx prisma generate

  <button id='installPartTwoBtnId' style='margin-left:14rem;'>continue</button><button id='cancelPartTwoBtnId'>cancel</button>  
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


      <div style='display:flex;height:1.4re !important;margin:0;padding:0;'>
        <input id="inputBoxWidthId" type="text" value='16rem' style='margin:0 1rem 0 0; padding:0 0 0 1rem;width:7rem;height:1.4rem !important;line-height:1.1rem;display:inline-block;' placeholder='CSS px, rem, ...'/>
        <label for="CRInput" style='display:inline-block;width:max-content'>All input boxes CSS width</label>
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
</body>
<script>
  // Webview Extension
  let tablesModel = 'waiting for schemaModels '
  let rootPath = ''
  const vscode = acquireVsCodeApi()
  const noPrismaSchemaL = ${noPrismaSchema} ? true : false;
  const installPartTwoPending = ${installPartTwoPending} ? true : false;

  vscode.postMessage({ command: 'log', text: "noPrismaSchema:${noPrismaSchema}; pending: ${installPartTwoPending}" })

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
  let installPartOneEl;
  let installPartTwoEl;
  let installPartOneBtnEl;
  let cancelPartOneBtnEl;
  let installPartTwoBtnEl;
  let cancelPartTwoBtnEl;
  let crudUIBlockEl;
  let rightColumnEl;
  let schemaContainerEl;
  let crudSupportDoneEl;
  let fieldModelsJSON;
  let fieldModels;
  let theFields = [];
  let msgEl;
  let labelEl;
  let routeName = '';
  let modelObjName = '';
  let routeLabelNode;
  let timer;
  let noRemoveHint = false;
  let inputBoxWidthEl;

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
    inputBoxWidthEl = document.getElementById('inputBoxWidthId');
    routeLabelNode = Array.from(labelEl.childNodes).filter(
      (node) => node.nodeType === Node.TEXT_NODE
      )[0];
    msgEl = document.getElementById('messagesId')
    msgEl.addEventListener('dblclick', () => {
      msgEl.innerHTML = '<pre>'
    })


    if (noPrismaSchemaL){
      installPartOneBtnEl.addEventListener('click', () => {
      // vscode.postMessage({ command: 'log', text: 'InstallPartOneBtn clicked' })
        // get dbname, owner and owner password if specified
        try{
          const db = {};
          db.name = document.getElementById('dbNameId').value;
          db.owner = document.getElementById('dbOwnerId').value;
          db.password = document.getElementById('dbOwnerPasswordId').value;
          db.host = document.getElementById('dbHostId').value;
          db.port = document.getElementById('dbPortId').value;
          vscode.postMessage({ command: 'setDbAndOwner', payload: db });
        }catch(err){
          const msg = err instanceof Error ? err.message : String(err);
          vscode.postMessage({ command: 'log', text: 'get db err '+ msg })
        }
        vscode.postMessage({ command: 'installPrismaPartOne' })
        installPartOneBtnEl.innerText = 'installing...'
      })
      cancelPartOneBtnEl.addEventListener('click', cancelAnyPart)
      // fires once so be ready it extension waits for schema and connection
      installPartTwoBtnEl.addEventListener('click', installPartTwo)
      cancelPartTwoBtnEl.addEventListener('click', cancelAnyPart)
    }
    if (installPartTwoPending){
      vscode.postMessage({ command: 'log', text: 'pending!'})
      installPartTwoBtnEl.addEventListener('click', installPartTwo)
      cancelPartTwoBtnEl.addEventListener('click', cancelAnyPart)
    }
    // vscode.postMessage({ command: 'log', text: 'BEFORE TURNING PARTS VISIBLE' })

    if (noPrismaSchemaL) {
      vscode.postMessage({ command: 'log', text: '-- noPrismaSchemaL'})
      // all blocks start hidden
      installPartOneEl.classList.remove('hidden')
    }
    else if (installPartTwoPending){
      console.log('console.log -- installPartTwoPending')
      installPartTwoEl.classList.remove('hidden')
      // vscode.postMessage({ command: 'log', text: 'PRISMA PART TWO INSTALLATION' })
    }
    else {
      // console.log('console.log -- Create CRUD Support')
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
    
    if (msg.command === 'ORMFieldsSent'){
      msgEl.innerHTML += "<p>target: " + msg.target +"</p>" + msg.markup;
    }

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
      renderParsedSchema(msg.payload);
      rootPath = msg.rootPath;
      fieldModels= msg.modelsFieldNames;
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

    labelEl.style.color = '';
    routeLabelNode.textContent = 'Route Name';
  }

  // a parsed schema from a Prisma ORM is sent back from the extension
  // and as it is an HTML collection we turn it into an Object with
  // entries to be destructed into individual object properties
  function renderParsedSchema(schemaModels) {

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


        for (const [fieldName, { type, prismaAttrs }] of Object.entries(fields)) {
          if ('0|1'.includes(fieldName)) continue
          types += \`\${fieldName}: \${dateTimeToDate(type)};
    \`
          if (prismaAttrs.includes('@default') || prismaAttrs.includes('@updatedAt') || prismaAttrs.includes('@unique')) {
            m += \`<p>\${fieldName}</p><p>type:\${type} <span style='color:pink'>\${prismaAttrs ?? 'na'}</span></p>\`
          } else {
            m += \`<p>\${fieldName}</p><p>type:\${type} \${prismaAttrs ?? 'na'}</p>\`
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
      vscode.postMessage({ command: 'saveTypes', payload: {types, includeTypes} })
    } catch (err) {
      vscode.postMessage({command: 'log',  text: 'renderParsedSchema: ' + err });
    }
    // now all the markup constructed as a string render into  schemaContainerEl
    schemaContainerEl.innerHTML = markup

    // schemaContainerEl gets click event but it has to be from the first <p> element
    // and that fieldname (innerText) id ignored if already saved in the fields
    schemaContainerEl.addEventListener('click', (event) => {

      if (event.target.tagName === 'SUMMARY') {

        modelObjName = event.target.innerText;
        routeNameEl.value = modelObjName.toLowerCase();
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
          // msgEl.innerHTML += '<br/>SUMMARY fieldModels found: '+ JSON.stringify(fieldModels) + ' modelObjName: '+ modelObjName;

          vscode.postMessage({ command: 'log',  text: 'before calling Extension renderORMFields' });
          vscode.postMessage({ command: 'renderORMFields', target: 'just a string' })
          vscode.postMessage({ command: 'log',  text: 'after calling Extension renderORMFields' });

          try{
            theFields = fieldModels[modelObjName];
            msgEl.innerHTML += '<pre>'+ theFields + '</pre>';
            if (theFields){
              for (field of theFields){
                // msgEl.innerHTML += '<br/>theFields loop: '+ theFields[i];
                fieldNameEl.value = field;
                fieldNameEl.dispatchEvent(enterKeyEvent);
              }
              msgEl.innerHTML += '<pre>fields<br/>'+ JSON.stringify(fields,null,2) + '</pre>';
              return
            }
          }catch(err){
            const msg = err instanceof Error ? err.message : String(err);
            msgEl.innerHTML += '<br/>fieldModels[modelObjName] NOT found err: '+ msg
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

  // its data-field-index are read via el.getAttribute('data-field-index')
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

  // when a fieldsList schemaContainerEl is full scroll it 
  // so the last element gets visible
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

  // the two input boxes for route name and fieldName, which are
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
      const inputBoxWidth = inputBoxWidthEl.value ?? '16rem';
      document.querySelector('.crud-support-done').innerHTML = "route <span style='color:pink;'>" + routeNameEl.value + "</span>  created";
      const payload = { routeName, modelObjName, fields, inputBoxWidth, embellishments: selectedCheckboxes() }
      vscode.postMessage({ command: 'createCrudSupport', payload: payload })
    }
  })
</script>
</body>

</html>
`
}

