import {throttle} from 'throttle-debounce'
import {writable, get} from 'svelte/store'
import {assoc, batch, sleep, chunk, now} from '@welshman/lib'
import type {SignedEvent} from '@welshman/util'
import {isShareableRelayUrl} from '@welshman/util'
import {subscribe} from '@welshman/net'
import type {SubscribeRequest, Subscription} from '@welshman/net'

export const day = 86400

export const relays = [
  "wss://purplepag.es",
  "wss://relay.damus.io",
  "wss://relay.nostr.band",
  "wss://relay.snort.social",
  "wss://nostr.wine",
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

export const loadPubkeyInfo = async (pubkey: string) => {
  let follows: string[] = []

  await load({
    relays,
    filters: [{authors: [pubkey], kinds: [3]}],
    onEvent: (e: SignedEvent) => {
      follows = e.tags.filter(t => t[0] === 'p').map(t => t[1])
    },
  })

  return follows
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
      relays,
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

  for (const authors of chunk(100, $follows)) {
    await load({
      relays,
      onEvent,
      filters: [{authors, kinds: [1], since: now() - $daysAgo * day}],
    })
  }

  sub?.close()
  sub = subscribe({
    relays,
    filters: [{authors: $follows.slice(0, 1000), kinds: [1], since: now()}],
  })

  sub.emitter.on('event', (url: string, e: SignedEvent) => onEvent(e))
}

// Nip07

let lock = Promise.resolve()

export const getExtension = () => (window as {nostr?: any}).nostr

export const withExtension = (f: (ext: any) => void) => {
  lock = lock.then(() => f(getExtension()))

  return lock
}

export const login = () =>
  withExtension(async ext => {
    const $pubkey = await ext.getPublicKey()

    follows.set(await loadPubkeyInfo($pubkey))
    pubkey.set($pubkey)
  })

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
