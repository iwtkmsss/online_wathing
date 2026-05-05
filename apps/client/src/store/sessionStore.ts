import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { UserDto } from "../lib/api";

type SessionState = {
  nickname: string;
  user: UserDto | null;
  setNickname: (nickname: string) => void;
  setUser: (user: UserDto) => void;
  reset: () => void;
};

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      nickname: "",
      user: null,
      setNickname: (nickname) => set({ nickname }),
      setUser: (user) => set({ user, nickname: user.nickname }),
      reset: () => set({ nickname: "", user: null })
    }),
    {
      name: "viktorias-edition-session"
    }
  )
);
