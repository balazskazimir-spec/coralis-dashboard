'use client'

import { createContext, useContext, useMemo, useSyncExternalStore } from 'react'
import { DEFAULT_USERS } from '@/lib/access'
import type { AppUser } from '@/lib/types'

type RoleContextValue = {
  users: AppUser[]
  currentUser: AppUser
  setCurrentUserId: (userId: string) => void
  updateUser: (userId: string, updates: Partial<AppUser>) => void
}

const USERS_STORAGE_KEY = 'coralis-users'
const CURRENT_USER_STORAGE_KEY = 'coralis-current-user'
const ROLE_EVENT = 'coralis-role-change'

const RoleContext = createContext<RoleContextValue | null>(null)

let cachedUsersRaw: string | null = null
let cachedUsersSnapshot: AppUser[] = DEFAULT_USERS
let cachedCurrentUserId: string = DEFAULT_USERS[0].id

function readUsersSnapshot() {
  if (typeof window === 'undefined') {
    return DEFAULT_USERS
  }

  const storedUsers = window.localStorage.getItem(USERS_STORAGE_KEY)
  if (!storedUsers) {
    cachedUsersRaw = null
    cachedUsersSnapshot = DEFAULT_USERS
    return DEFAULT_USERS
  }

  if (storedUsers === cachedUsersRaw) {
    return cachedUsersSnapshot
  }

  try {
    const parsedUsers = JSON.parse(storedUsers) as AppUser[]
    cachedUsersRaw = storedUsers
    cachedUsersSnapshot = Array.isArray(parsedUsers) && parsedUsers.length > 0 ? parsedUsers : DEFAULT_USERS
    return cachedUsersSnapshot
  } catch {
    cachedUsersRaw = null
    cachedUsersSnapshot = DEFAULT_USERS
    return DEFAULT_USERS
  }
}

function readCurrentUserIdSnapshot() {
  if (typeof window === 'undefined') {
    return DEFAULT_USERS[0].id
  }

  cachedCurrentUserId = window.localStorage.getItem(CURRENT_USER_STORAGE_KEY) || DEFAULT_USERS[0].id
  return cachedCurrentUserId
}

function subscribe(callback: () => void) {
  if (typeof window === 'undefined') {
    return () => {}
  }

  const onStorage = () => callback()
  window.addEventListener('storage', onStorage)
  window.addEventListener(ROLE_EVENT, onStorage)

  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(ROLE_EVENT, onStorage)
  }
}

function emitRoleChange() {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new Event(ROLE_EVENT))
}

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const users = useSyncExternalStore(subscribe, readUsersSnapshot, () => DEFAULT_USERS)
  const currentUserId = useSyncExternalStore(subscribe, readCurrentUserIdSnapshot, () => DEFAULT_USERS[0].id)

  const currentUser = useMemo(() => {
    return users.find((user) => user.id === currentUserId) || users[0] || DEFAULT_USERS[0]
  }, [currentUserId, users])

  function setCurrentUserId(userId: string) {
    window.localStorage.setItem(CURRENT_USER_STORAGE_KEY, userId)
    cachedCurrentUserId = userId
    emitRoleChange()
  }

  function updateUser(userId: string, updates: Partial<AppUser>) {
    const nextUsers = users.map((user) =>
      user.id === userId
        ? {
            ...user,
            ...updates,
          }
        : user
    )

    window.localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(nextUsers))
    cachedUsersRaw = JSON.stringify(nextUsers)
    cachedUsersSnapshot = nextUsers

    if (!nextUsers.some((user) => user.id === currentUserId)) {
      const fallbackUserId = nextUsers[0]?.id || DEFAULT_USERS[0].id
      window.localStorage.setItem(CURRENT_USER_STORAGE_KEY, fallbackUserId)
      cachedCurrentUserId = fallbackUserId
    }

    emitRoleChange()
  }

  return (
    <RoleContext.Provider
      value={{
        users,
        currentUser,
        setCurrentUserId,
        updateUser,
      }}
    >
      {children}
    </RoleContext.Provider>
  )
}

export function useRole() {
  const context = useContext(RoleContext)

  if (!context) {
    throw new Error('useRole must be used inside RoleProvider')
  }

  return context
}
