import * as nl from 'nostr-login'
import {throttle} from 'throttle-debounce'
import {writable, get} from 'svelte/store'
import {assoc, batch, sleep, chunk, now} from '@welshman/lib'
import type {SignedEvent} from '@welshman/util'
import {isShareableRelayUrl} from '@welshman/util'
import {subscribe} from '@welshman/net'
import type {SubscribeRequest, Subscription} from '@welshman/net'

export const day = 86400

export const indexerRelays = [
  "wss://purplepag.es",
  "wss://relay.damus.io",
  "wss://relay.nostr.band",
]

export const contentRelays = [
  "wss://relay.damus.io",
  "wss://relay.snort.social",
  "wss://nos.lol",
]

export type MySubscribeRequest = SubscribeRequest & {
  onEvent: (e: SignedEvent) => void
}

export const load = ({onEvent, ...request}: MySubscribeRequest) => {
  const sub = subscribe({immediate: true, timeout: 1000, closeOnEose: true, ...request})

  sub.emitter.on('event', (url, e) => onEvent(e))

  return sub.result
}

// Types

export type Person = {
  pubkey: string
  events: SignedEvent[]
  profile?: Record<string, any>
  last_post?: SignedEvent
}

// State

export const synced = <T>(key: string, defaultValue: T, delay = 300) => {
  let value = defaultValue

  if (localStorage.getItem(key)) {
    try {
      value = JSON.parse(localStorage.getItem(key) || "")
    } catch (e) {
      // pass
    }
  }

  const store = writable<T>(value)

  store.subscribe(throttle(delay, ($value: T) => localStorage.setItem(key, JSON.stringify($value))))

  return store
}

export const maxPosts = writable(10)

export const daysAgo = writable(3)

export const pubkey = synced<string>("pubkey", "")

export const follows = synced<string[]>("follows", [])

export const people = writable<Record<string, Person>>({})

// Loaders

export const loadFollows = async () => {
  let pubkeys: string[] = []

  await load({
    relays: indexerRelays,
    filters: [{authors: [get(pubkey)], kinds: [3]}],
    onEvent: (e: SignedEvent) => {
      pubkeys = e.tags.filter(t => t[0] === 'p').map(t => t[1])
    },
  })

  follows.set(pubkeys)
}

let sub: Subscription

export const loadData = async () => {
  const $people = get(people)
  const $follows = get(follows)
  const $daysAgo = get(daysAgo)
  const getDefaultPerson = (pubkey: string): Person => ({pubkey, events: []})

  const missingProfilePubkeys = $follows.filter(pk => !$people[pk]?.profile)

  if (missingProfilePubkeys.length > 0) {
    await load({
      relays: indexerRelays,
      filters: [{authors: missingProfilePubkeys, kinds: [0]}],
      onEvent: batch(300, (events: SignedEvent[]) => {
        people.update($p => {
          for (const e of events) {
            try {
              const profile = $p[e.pubkey] || getDefaultPerson(e.pubkey)

              $p[e.pubkey] = {...profile, profile: JSON.parse(e.content)}
            } catch (e) {
              // pass
            }
          }

          return $p
        })
      }),
    })
  }

  const onEvent = batch(300, (events: SignedEvent[]) => {
    people.update($p => {
      for (const e of events) {
        const profile = $p[e.pubkey] || getDefaultPerson(e.pubkey)

        profile.events.push(e)

        $p[e.pubkey] = profile
      }

      return $p
    })
  })

  // Double chunk so we can make sure to get results for all pubkeys, while also only asking for 100 at a time.
  for (const authorsChunk of chunk(10, chunk(10, $follows))) {
    await Promise.all(
      authorsChunk.map(authors =>
        load({
          relays: contentRelays,
          filters: [{authors, kinds: [1], since: now() - $daysAgo * day}],
          onEvent,
        })
      )
    )
  }

  sub?.close()
  sub = subscribe({
    relays: contentRelays,
    filters: [{authors: $follows.slice(0, 1000), kinds: [1], since: now()}],
  })

  sub.emitter.on('event', (url: string, e: SignedEvent) => onEvent(e))
}

// Auth

nl.init({noBanner: true})

export const loginUser = () => {
  nl.launch()

  return new Promise<void>(resolve => {
    document.addEventListener('nlAuth', async (e: any) => {
      if (e.detail.pubkey) {
        pubkey.set(e.detail.pubkey)
      }

      resolve()
    }, {once: true})
  })
}

export const logoutUser = () => {
  nl.logout()
  pubkey.set("")
  follows.set([])
}

// Utils

type ScrollerOpts = {
  delay?: number
  threshold?: number
  reverse?: boolean
  element?: Element
}

export const createScroller = (
  loadMore: () => Promise<void>,
  {delay = 500, threshold = 4000, reverse = false, element}: ScrollerOpts = {},
) => {
  let done = false
  const check = async () => {
    // While we have empty space, fill it
    const {scrollY, innerHeight} = window
    // @ts-ignore
    const {scrollHeight, scrollTop} = element
    const offset = Math.abs(scrollTop || scrollY)
    const shouldLoad = offset + innerHeight + threshold > scrollHeight

    // Only trigger loading the first time we reach the threshold
    if (shouldLoad) {
      await loadMore()
    }

    // No need to check all that often
    await sleep(delay)

    if (!done) {
      requestAnimationFrame(check)
    }
  }

  requestAnimationFrame(check)

  return {
    check,
    stop: () => {
      done = true
    },
  }
}
