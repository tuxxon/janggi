// 설정 패널의 자리(위/아래)별 설정. 게임 상태·기보는 나라(c/h)별로 저장하고, 화면은 자리별로 보여준다.
// 두는 이·상차림은 자리에 붙어 있다: 아래(사람)가 한나라로 바뀌어도 아래는 계속 사람이다.
import { other } from "./engine.js";
import { setControllers } from "./game.js";

// 판 아래쪽 나라. 방향이 없는 옛 기보는 예전 규칙(한만 사람이면 한이 아래)을 따른다.
export const bottomOf = (game) => game.bottom ?? (game.controllers.h === "human" && game.controllers.c !== "human" ? "h" : "c");
export const nationAt = (bottom, seat) => (seat === "bottom" ? bottom : other(bottom));

export function seatsOf(game) {
  const bottomNation = bottomOf(game);
  const seat = (s) => { const n = nationAt(bottomNation, s); return { who: game.controllers[n], setup: game.setups[n] }; };
  return { bottomNation, top: seat("top"), bottom: seat("bottom") };
}

// 한 자리의 나라를 고르면 다른 자리는 반대 나라가 된다(연동).
export const chooseNation = (seats, seat, nation) => ({ ...seats, bottomNation: seat === "bottom" ? nation : other(nation) });

// 새 게임 설정(나라별). 선수는 항상 초다(game.newGame 의 turn: "c").
export function nextGame(seats) {
  const b = seats.bottomNation, t = other(b);
  return { bottom: b, controllers: { [b]: seats.bottom.who, [t]: seats.top.who }, setups: { [b]: seats.bottom.setup, [t]: seats.top.setup } };
}

// 새 게임을 눌러야 적용되는 변경(화면의 "새 게임부터" 표시용). 두는 이는 즉시 적용이라 빠진다.
export function pendingOf(seats, level, game) {
  const now = seatsOf(game);
  return { nation: seats.bottomNation !== now.bottomNation, top: seats.top.setup !== now.top.setup,
    bottom: seats.bottom.setup !== now.bottom.setup, level: level !== game.level };
}

// 자리의 두는 이를 지금 판에 적용: 지금 판에서 그 자리에 앉은 나라의 컨트롤러를 바꾼다.
export const whoApplied = (game, seat, who) => ({ ...game.controllers, [nationAt(bottomOf(game), seat)]: who });

// 두는 이 변경을 지금 판에 반영한 새 게임 상태. 끝난 판은 건드리지 않는다: 다음 판 준비로 선택 상자를 바꿨는데
// 끝난 판의 기보(컨트롤러)와 결과 문구("이겼어요/졌어요")가 바뀌면 안 된다(리뷰 MED).
export const withWho = (game, seat, who) => (game.over ? game : setControllers(game, whoApplied(game, seat, who)));
