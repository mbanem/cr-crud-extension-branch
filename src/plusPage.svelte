<script lang="ts">
  // /category/+page.svelte
  import type { Snapshot } from '../$types'
  import { onMount } from 'svelte'
  import type { PageData, ActionData } from './$types'
  import type { SubmitFunction } from '@sveltejs/kit'
  import { enhance } from '$app/forms'
  import { invalidateAll } from '$app/navigation'
  import { page } from '$app/state' // for page.status code on actions
  import * as utils from '$lib/utils'
  import * as Types from '$lib/types/types'
  import CRInput from '$lib/components/CRInput.svelte'
  import CRSpinner from '$lib/components/CRSpinner.svelte'
  import CRActivity from '$lib/components/CRActivity.svelte'
  import CRTooltip from '$lib/components/CRTooltip.svelte'
  import CRSummaryDetail from '$lib/components/CRSummaryDetail.svelte'

  interface IStringBoolean {
    [key: string]: boolean
  }
  type ARGS = {
    data: PageData
    form: ActionData
  }
  let { data, form }: ARGS = $props()
  let idIsNumeric = true
  let idEl: Types.TCRInput | null = null
  let nameEl: Types.TCRInput | null = null

  let uiElements: Array<Types.TCRInput> = [idEl, nameEl]
  let nullSnap = {
    id: null,
    name: null,
  } as Types.CategoryPartial

  let snap = $state<Types.CategoryPartial>(nullSnap)
  const snap_ = () => {
    return snap
  }

  const rowSelected = async (event: MouseEvent) => {
    event.preventDefault()
    const el = event.target as HTMLParagraphElement
    let idx = el.innerText.split(':')[0]
    let id = idIsNumeric ? Number(idx) : String(idx)
    snap = data.categories?.filter(
      (el: Types.CategoryPartial) => el.id === id
    )[0] as Types.CategoryPartial
    await utils.sleep(300)
    uiElements[0].setInputBoxValue(id)
    uiElements[1].setFocus()
    uiElements[0].setInputBoxValue(id)
  }

  let selectedUserId = $state(data.locals?.user.id) as string

  let btnCreate: HTMLButtonElement
  let btnUpdate: HTMLButtonElement
  let btnDelete: HTMLButtonElement
  let btnClear: HTMLButtonElement
  let result = $state('')
  const clearMessage = () => {
    setTimeout(() => {
      result = ''
    }, 2000)
  }

  // returns status[formValid, partiallyValid], on partiallyValid we can do update
  // for Create new record full formValid with no id must be true
  let formDataValid = $derived.by(() => {
    const status = [true, false]
    if (utils.same<Types.CategoryPartial>(snap_(), nullSnap))
      return [false, false]
    for (const [key, value] of Object.entries(snap_())) {
      if ('id|updatedAt'.includes(key)) continue
      if (value) {
        status[1] = true
      } else {
        status[0] = false
      }
    }
    return status
  })

  let dBtnCreate = $state(true)
  let dBtnUpdate = $state(true)
  let dBtnDelete = $state(true)

  let idOK = $derived(snap.id !== null)
  $effect(() => {
    dBtnCreate = idOK || !formDataValid[0]
    dBtnUpdate = !idOK || !formDataValid[1]
    dBtnDelete = !idOK
    if (idEl === document.activeElement) {
      idEl.required = dBtnCreate
      const id = (idEl as Types.TCRInput)?.getInputBoxValue()
      if (id) {
        const sn = data.categories?.filter(
          (el) => el.id === id
        )[0] as Types.CategoryPartial
        if (sn.name !== snap.name) {
          snap.name = sn.name
        }
      }
    }
  })

  const clearForm = (event?: MouseEvent | KeyboardEvent) => {
    event?.preventDefault()
    snap = nullSnap
  }

  let spin: IStringBoolean = $state({
    create: false,
    update: false,
    delete: false,
    clear: false,
  })

  const enhanceSubmit: SubmitFunction = async ({
    action,
    formData,
    cancel,
  }) => {
    spin[action.search.slice(2)] = true // start spinner animation
    if (action.search === '?/clear') {
      snap = nullSnap
      cancel()
      return false
    }
    const required: string[] = []
    for (const [key, value] of Object.entries(snap)) {
      formData.set(key, value as string)
      if (!value) {
        const req = key + ' is required'
        const el = document.querySelector('[title="' + key + '"]')
        if (el) {
          ;(el as HTMLInputElement).placeholder += req
          required.push(req)
        }
      }
    }

    if (required.join('').length) {
      return
    }

    result =
      action.search === '?/create'
        ? 'creating category...'
        : action.search === '?/update'
          ? 'updating category...'
          : 'deleting category...'

    return async ({ update }) => {
      await update()

      if (action.search === '?/create') {
        result = page.status === 200 ? 'category created' : 'create failed'
      } else if (action.search === '?/update') {
        result = page.status === 200 ? 'category updated' : 'update failed'
      } else if (action.search === '?/delete') {
        result = page.status === 200 ? 'category deleted' : 'delete failed'
      }
      spin[action.search.slice(2)] = false // stop spinner animation
      invalidateAll()
      clearForm()
      utils.hideButtonsExceptFirst([btnClear, btnCreate, btnUpdate, btnDelete])
      clearMessage()
    }
  }
  // let owner = true;
  const color = 'blue' // spinner color
  // const handleWindowLoad = () => {
  // 	console.log('page fully loaded');
  // };
  onMount(async () => {
    nameEl.setFocus()
    await utils.sleep(200)
    idEl.setFocus()
  })
</script>

<!-- <svelte:window onload={handleWindowLoad} /> -->
<svelte:head>
  <title>Category Page</title>
</svelte:head>
<CRActivity
  PageName="Category"
  bind:result
  bind:selectedUserId
  user={data.locals?.user}
  users={data.users as Types.UserPartial[]}
></CRActivity>

<div class="two-column-grid">
  <div class="left-column">
    <form action="?/create" method="post" use:enhance={enhanceSubmit}>
      <div class="form-wrapper">
        <CRInput
          title="id"
          bind:this={idEl}
          exportValueOn="enter|blur"
          type="number"
          capitalize={false}
          bind:value={snap.id as number}
          required={!dBtnCreate}
          width="22.5rem"
        ></CRInput>
        <CRInput
          title="name"
          bind:this={nameEl}
          exportValueOn="enter|blur"
          type="text"
          capitalize={true}
          bind:value={snap.name as string}
          required={!dBtnUpdate}
          width="22.5rem"
        ></CRInput>

        <div class="buttons-row">
          <div class="buttons">
            <CRSpinner
              bind:button={btnCreate}
              spinOn={spin.create}
              caption="create"
              formaction="?/create"
              hidden={dBtnCreate}
            ></CRSpinner>
            <CRSpinner
              bind:button={btnUpdate}
              spinOn={spin.update}
              caption="update"
              formaction="?/update"
              hidden={dBtnUpdate}
            ></CRSpinner>
            <CRSpinner
              bind:button={btnDelete}
              spinOn={spin.delete}
              caption="delete"
              formaction="?/delete"
              hidden={dBtnDelete}
            ></CRSpinner>
            <CRSpinner
              bind:button={btnClear}
              spinOn={false}
              caption="clear"
              formaction="?/clear"
              hidden={false}
            ></CRSpinner>
          </div>
        </div>
      </div>
    </form>
  </div>

  <div class="right-column" onclick={rowSelected} aria-hidden={true}>
    {#each data.categories as r (r.id)}
      <div class="grid-row">
        <p>{r.id}: {r.name}</p>
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
      width: 100%;
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
