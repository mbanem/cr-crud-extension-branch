<script lang="ts">
  import * as vscode from 'vscode'
  import * as fs from 'fs'
  import * as path from 'path'
  import * as os from 'os' // to find the work folder path
  import * as childProcess from 'child_process'

  //  --- global variables estableished by activate and running Webview Extension ----
  let rootPath = '' // set by activate
  let routesPath = '' // set by activate
  const pgPassPath = path.join(os.homedir(), '.pgpass')
  const pendingFilePath = path.join(rootPath, '/prisma/installPartTwo.pending')
  const prismaConfigFile = path.join(rootPath, 'prisma.config.ts')

  let modelObjName_ = ''
  let modelObjName_s = ''
  let modelObjCName_ = ''
  let sudoName_ = '' // await execShell('whoami')
  let embellishments_: string[] = []
  let terminal: vscode.Terminal // created on the first call of sendToTerminal(cmd: string)
  let noPrismaSchema = false // ask for installing Prisma ORM
  let installPartTwoPending = false // wait for schema.prisma and .env DATABASE_URL
  let pm = 'unknown' // package manager npm, pnpm, yarn, bun, ... from detectPackageManager()
  let ex = 'unknown'
  let fields_: string[] = []
  type TRStringBoolean = Record<string, boolean>
  type TRStringString = Record<string, string>
  type TRFieldNameType = Record<string /*fieldName*/, string /*type*/>
  type TRSelectBlock = Record<
    string /*modelName*/,
    TRStringString /*Array<fieldName,boolean> */
  >
  type TRModelFields = Record<string /*modelName*/, TRFieldNameType>
  type TRModels = Record<string /*modelName*/, TRFieldNameType>
  let db_: TRStringString = {}
  const selectBlocks: TRSelectBlock = {}
  const modelFields: TRModelFields = {}
  // fields list first part is from ordered following by non-ordered rest
  const ordered = [
    'id',
    'authorId',
    'userId',
    'employeeId',
    'customerId',
    'ownerId',
    'firstName',
    'lastName',
    'middleName',
    'name',
    'profileId',
    'dob',
    'dateOfBirth',
    'email',
    'password',
    'address',
    'city',
    'state',
    'title',
    'content',
    'category',
    'role',
    'priority',
    'price',
    'updatedAt',
  ]
  const catchCodeBlock = 
  // ------------  functions ---------------

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
    if (!fs.existsSync(pendingFilePath)) {
      fs.writeFileSync(
        pendingFilePath,
        'install Prisma PartOne is done.\nInstallPartTwo is pending but may be already done by User.'
      )
    }
  }
  function creatPrismaConfigFile() {
    // problems with prisma.config.ts and finding URL
    fs.writeFileSync(
      prismaConfigFile,
      `import "dotenv/config"
      export default {
        schema: "prisma/schema.prisma",
        migrations: {
          path: "prisma/migrations",
        },
        datasource: { 
          url: process.env.DATABASE_URL,
        },
      }`
    )
  }
  function deleteTemoraryFiles() {
    if (fs.existsSync(pendingFilePath)) {
      fs.unlink(pendingFilePath, (err) => {
        if (err) {
          vscode.window.showInformationMessage(
            'Could not delete installPartTwo.pending file at /prisma. Please delete it yourself'
          )
        }
      })
    }
    if (fs.existsSync(pgPassPath)) {
      fs.unlink(pgPassPath, (err) => {
        if (err) {
          vscode.window.showInformationMessage(
            'Could not delete .pgpass file at /home directory. Pleae delete it yourself'
          )
        }
      })
    }

    fs.writeFileSync(
      prismaConfigFile,
      `import "dotenv/config"
      export default {
        schema: "prisma/schema.prisma",
        migrations: {
          path: "prisma/migrations",
        },
        datasource: { 
          url: process.env.DATABASE_URL,
        },
      }`
    )
  }
  // blockChangeProps('User', 'no null') returns object of id: string, firstName: string, ...
  // blockChangeProps('User') returns object of id: true, firstName: true, ...
  // blockChangeProps('User', ': string') turns every prop type to string id: string, firstName: string, ...
  function blockChangeProps(block: string, prop: string = ': true') {
    // initial props "string | null" to be replaced with the prop
    // or when prop === 'no null' to remove | null from prop type
    let list = `{ `
    for (const [modelName, v] of Object.entries(selectBlocks[block])) {
      if (prop === 'no null') {
        list += `${modelName}: ${v.replace(/ \| null/, ', ')}`
      } else {
        list += `${modelName}${prop}, `
      }
    }
    return list.slice(0, -2) + ' }'
  }

  function shouldSelectUsers() {
    if (modelObjName_ !== 'user') {
      return `const users = await db.user.findMany({
    select: ${blockChangeProps('User').replace(/password: true,/, '')}
  });`
    }
    return ''
  }
</script>
