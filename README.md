# cr-crud-extension README

On start the extension offers to install Prisma ORM
in two parts if not found.
In the Part One it install the required packages and
initiate Prisma with a simple /prisma/schema.prisma
at the app route and an .env file if not found and put
a flag file /prisma/installPartTwo.pending to signal
that Part One is done and the next is Part Two of the
installation and then opens schema.prisma and .env
contents in two VsCode Editor tabs offering you

1. to wait for completing schema.prisma models (time
   consuming task) and the connection string in opened
   .env file and to press the continue button at the
   pausing Extension, or
2. Press the cancel button to close the Extension and
   finish with preparing the schema and the connection
   string and start the Extension again. As the Extension
   finds a flag file /prisma/installPartTwo.pending it
   starts with Part Two of the installation and finish
   with the installation.
   Then it shows the Prisma Installation Part One page as it
   will initially when it finds the Prisma ORM is already
   install.
   In the right column it shows all the model/table names found
   in the schema.prisma and clicking on any would open a list
   of their columns while filling out the
   - routeName field with the model name in lowercase and
   - Candidate Fields with all the columns that are UI viable
     -- as some fields are handled by Prisma itself like
     id and reference fields, or are not meant to be exposed
     online like passwordHash, userAuthorizationToken that
     are rendered in pink.
     When Candidate Fields are completed and the routeName is
     updated if necessary pressing the Create CRUD Support would
     create at given routeName folder a +page.svelte UI holding
     input boxes for all Candidate Fields with buttons for create,
     update and delete, and a accompanying +page.server.ts file
     that holds load function, and create, update and delete actions.
