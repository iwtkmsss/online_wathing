import { Loader2, LogIn, Sparkles } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent
} from "react";
import type { UserDto } from "../lib/api";
import "../styles/HeroPerson.css";

type HeroPersonProps = {
  className?: string;
  nickname: string;
  user: UserDto | null;
  isSubmitting: boolean;
  onNicknameChange: (value: string) => void;
  onLoginSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onPersonClick?: () => void;
};

function HeroPerson({
  className,
  nickname,
  user,
  isSubmitting,
  onNicknameChange,
  onLoginSubmit,
  onPersonClick
}: HeroPersonProps) {
  const [isTouchActive, setIsTouchActive] = useState(false);
  const touchAnimationTimerRef = useRef<number | null>(null);

  const triggerTouchAnimation = () => {
    setIsTouchActive(true);

    if (touchAnimationTimerRef.current !== null) {
      window.clearTimeout(touchAnimationTimerRef.current);
    }

    touchAnimationTimerRef.current = window.setTimeout(() => {
      setIsTouchActive(false);
      touchAnimationTimerRef.current = null;
    }, 500);
  };

  useEffect(() => {
    return () => {
      if (touchAnimationTimerRef.current !== null) {
        window.clearTimeout(touchAnimationTimerRef.current);
      }
    };
  }, []);

  const handlePersonClick = () => {
    triggerTouchAnimation();

    if (onPersonClick) {
      onPersonClick();
    }
  };

  const handlePersonKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onPersonClick) {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      triggerTouchAnimation();
      onPersonClick();
    }
  };

  return (
    <section
      className={["hero-person-section", className].filter(Boolean).join(" ")}
      aria-label="Головний блок"
    >
      <div className="hero-person-content">
        <p className="hero-person-eyebrow">MarlineLabs Watch Party</p>
        <h2 className="hero-person-title">Viktoria's Edition</h2>

        <div className="hero-person-top">
          {user ? (
            <div className="hero-person-logged">
              <Sparkles aria-hidden="true" className="h-4 w-4 text-toxic" />
              <span>
                Ти в системі як{" "}
                <strong className="hero-person-logged-name">{user.nickname}</strong>.
                Переходь до кімнат і запускай перегляд.
              </span>
            </div>
          ) : (
            <form className="hero-person-login" onSubmit={onLoginSubmit}>
              <input
                className="hero-person-input"
                placeholder="Введи нікнейм"
                value={nickname}
                onChange={(event) => onNicknameChange(event.target.value)}
              />
              <button
                className="hero-person-button"
                disabled={isSubmitting || !nickname.trim()}
                type="submit"
              >
                {isSubmitting ? (
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                ) : (
                  <LogIn aria-hidden="true" className="h-4 w-4" />
                )}
                Увійти на сайт
              </button>
            </form>
          )}
        </div>

        <div
          className={[
            "hero-person-image-wrapper",
            onPersonClick ? "hero-person-image-wrapper-clickable" : "",
            isTouchActive ? "hero-person-image-wrapper-touch-active" : ""
          ]
            .filter(Boolean)
            .join(" ")}
          aria-label={onPersonClick ? "Перейти до кімнат" : undefined}
          role={onPersonClick ? "button" : undefined}
          tabIndex={onPersonClick ? 0 : undefined}
          onPointerDown={triggerTouchAnimation}
          onClick={handlePersonClick}
          onKeyDown={handlePersonKeyDown}
        >
          <img
            className="hero-person-img hero-person-img-official"
            src="/images/person-official.png"
            alt="Офіційне фото Вікторії"
          />
          <img
            aria-hidden="true"
            className="hero-person-img hero-person-img-alt"
            src="/images/person-alt.png"
            alt=""
          />
        </div>
      </div>
    </section>
  );
}

export default HeroPerson;
