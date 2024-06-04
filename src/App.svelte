<script lang="ts">
  import {nip19} from 'nostr-tools'
  import {onMount} from 'svelte'
  import {fly} from 'svelte/transition'
  import {get, derived, writable} from 'svelte/store'
  import {seconds, quantify} from "hurdak"
  import {sortBy, now, first, max} from '@welshman/lib'
  import {parse, render as renderParsed, truncate, ParsedType} from '@welshman/content'
  import type {Person} from './core'
  import Skeleton from './Skeleton.svelte'
  import {login, loadData, pubkey, follows, createScroller, day, people, contentRelays, maxPosts, daysAgo} from './core'

  const {locale} = new Intl.DateTimeFormat().resolvedOptions()

  const formatter = new Intl.DateTimeFormat(locale, {dateStyle: "short", timeStyle: "short"})

  const formatTimestamp = (ts: number) => formatter.format(new Date(ts * 1000))

  const formatTimestampRelative = (ts: number) => {
    let unit
    let delta = now() - ts
    if (delta < seconds(1, "minute")) {
      unit = "second"
    } else if (delta < seconds(1, "hour")) {
      unit = "minute"
      delta = Math.round(delta / seconds(1, "minute"))
    } else if (delta < seconds(2, "day")) {
      unit = "hour"
      delta = Math.round(delta / seconds(1, "hour"))
    } else {
      unit = "day"
      delta = Math.round(delta / seconds(1, "day"))
    }

    const locale = new Intl.RelativeTimeFormat().resolvedOptions().locale
    const formatter = new Intl.RelativeTimeFormat(locale, {
      numeric: "auto",
    })

    return formatter.format(-delta, unit as Intl.RelativeTimeFormatUnit)
  }

  const njump = (path: string) => `https://njump.me/${path}`

  const njumpEvent = (id: string) => njump(nip19.neventEncode({id, relays: contentRelays}))

  const njumpProfile = (pubkey: string) => njump(nip19.nprofileEncode({pubkey, relays: contentRelays}))

  const rows = derived([maxPosts, daysAgo, people], ([$maxPosts, $daysAgo, $people]) => {
    return sortBy(
      (p: Person) => -(p.last_post?.created_at || 0),
      Object
        .values($people)
        .map(p => {
          const since = now() - $daysAgo * day
          const events = p.events.filter(e => e.created_at > since)
          const last_post = first(sortBy(e => -e.created_at, events))

          return {...p, events, last_post}
        })
        .filter(p => p.profile && p.events.length < $maxPosts)
    )
  })

  const loadMore = async () => {
    limit += 20
  }

  const init = async () => {
    status = "loading"

    await login()

    if (get(follows).length === 0) {
      status = "new"
      pubkey.set("")
      alert("We weren't able to find your follows list. Please try again.")
    } else {
      await loadData()
      status = "ready"
    }
  }

  const reload = async () => {
    status = "loading"
    await loadData()
    status = "ready"
  }

  let element: any
  let scroller: any
  let status = $pubkey ? "ready" : "new"
  let limit = 20

  $: {
    if (element && !scroller) {
      scroller = createScroller(loadMore, {element})
    }
  }

  onMount(() => {
    if ($pubkey) {
      reload()
    }
  })
</script>

<main class="bg-base-200 min-h-screen">
  {#if status === "new"}
    <div class="hero min-h-screen">
      <div class="hero-content text-center">
        <div class="max-w-xl flex flex-col gap-4">
          <h1 class="text-5xl font-bold py-2">Welcome to keypub!</h1>
          <p>Keypub helps you keep up with <i>all</i> your follows.</p>
          <p>Click below to get started.</p>
          <div>
            <button class="btn btn-primary" on:click={init}>
              Login
            </button>
          </div>
        </div>
      </div>
    </div>
  {:else if status === "loading"}
    <div class="p-20 flex flex-col gap-4">
      <div class="flex gap-4 items-center mb-8">
        <span class="loading loading-spinner loading-lg"></span>
        <p>Hang tight - we're loading recent content from people you follow</p>
      </div>
      <Skeleton />
      <Skeleton />
    </div>
  {:else if status === "ready"}
    <div class="p-20 pt-4 flex flex-col gap-4" bind:this={element}>
      <div class="card bg-base-100 shadow-xl">
        <div class="card-body gap-4">
          <div class="flex flex-col gap-2 flex-grow">
            <label for="maxPosts" >Show people with fewer than {$maxPosts} recent posts</label>
            <input name="maxPosts" type="range" bind:value={$maxPosts} min="1" max="50" class="range" />
          </div>
          <div class="flex flex-col gap-2 flex-grow">
            <label for="daysAgo" >Show results from up to {quantify($daysAgo, 'day')} ago</label>
            <input name="daysAgo" type="range" bind:value={$daysAgo} min="1" max="60" class="range" />
          </div>
          <button class="btn" on:click={reload}>
            <svg fill="#000000" class="w-4 h-4" version="1.1" id="Capa_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 489.645 489.645" xml:space="preserve"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <g> <path d="M460.656,132.911c-58.7-122.1-212.2-166.5-331.8-104.1c-9.4,5.2-13.5,16.6-8.3,27c5.2,9.4,16.6,13.5,27,8.3 c99.9-52,227.4-14.9,276.7,86.3c65.4,134.3-19,236.7-87.4,274.6c-93.1,51.7-211.2,17.4-267.6-70.7l69.3,14.5 c10.4,2.1,21.8-4.2,23.9-15.6c2.1-10.4-4.2-21.8-15.6-23.9l-122.8-25c-20.6-2-25,16.6-23.9,22.9l15.6,123.8 c1,10.4,9.4,17.7,19.8,17.7c12.8,0,20.8-12.5,19.8-23.9l-6-50.5c57.4,70.8,170.3,131.2,307.4,68.2 C414.856,432.511,548.256,314.811,460.656,132.911z"></path> </g> </g></svg>
            Refresh posts
          </button>
        </div>
      </div>
      {#each $rows.slice(0, limit) as row (row.pubkey)}
        <div in:fly={{y: 20}} class="card bg-base-100 shadow-xl">
          <div class="card-body flex-row justify-between">
            <div class="flex gap-4 items-start">
              <div class="shrink-0 w-8 h-8 rounded-full bg-gray-700 bg-cover bg-center overflow-hidden">
                <img alt="" src={row.profile?.picture} />
              </div>
              <div class="flex flex-col gap-2">
                <a class="text-xl font-bold" target="_blank" href={njumpProfile(row.pubkey)}>
                  {row.profile?.display_name || row.profile?.name || row.pubkey.slice(0, 8)}
                </a>
                {#if row.last_post}
                  <div class="flex gap-2">
                    <span>
                      Last posted
                      <a class="link" target="_blank" href={njumpEvent(row.last_post.id)}>
                        {formatTimestampRelative(row.last_post.created_at)}
                      </a>
                    </span>
                    &bull;
                    {quantify(row.events.length, 'post')} found in the last {quantify($daysAgo, 'day')}
                  </div>
                  <p class="pl-2 border-l-2 border-solid border-base-400 mt-4 note-content" style="margin-left: -9px">
                    {#each truncate(parse(row.last_post)) as parsed}
                      {@html renderParsed(parsed)}
                    {/each}
                  </p>
                {:else}
                  <p>No recent posts found<p>
                {/if}
              </div>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</main>
