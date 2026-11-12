import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { SIDE_COLORS, TECH_COLOR } from '../lib/gameModes';
import { inviteUrl, type Invite } from '../lib/invite';
import type { GameSide, Side } from '../lib/types';
import { useGame, type GamePlace } from '../state/game';
import { useSession } from '../state/session';
import { useSide } from '../state/side';
import { Button, Card, Eyebrow, Icon, KeyboardScroll, tap, type IconName } from '../ui/components';
import { confirmDestructive } from '../ui/confirm';
import { GameScore, matchText, useMatch } from '../ui/GameScore';
import { QrCode } from '../ui/QrCode';
import { C, F, R } from '../ui/theme';

const MATCH_MINUTES = [10, 15, 20, 30, 45, 60];

export default function GameScreen() {
  const session = useSession();
  const side = useSide();
  const g = useGame();
  const headerHeight = useHeaderHeight();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      Alert.alert('Ошибка', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!session.firebaseEnabled || !session.uid) {
    return (
      <View style={styles.content}>
        <Card>
          <Text style={styles.text}>Большие игры работают только с подключением к серверу.</Text>
        </Card>
      </View>
    );
  }

  return (
    <KeyboardScroll contentContainerStyle={styles.content} headerOffset={headerHeight}>
      {!g.game ? <NoGame busy={busy} run={run} /> : g.isTech ? <TechView busy={busy} run={run} /> : <PlayerView run={run} />}
      {!g.isTech && side.isSideCommander && side.side && !side.side.gameId && <AttachSide busy={busy} run={run} />}
    </KeyboardScroll>
  );
}

type Run = (fn: () => Promise<unknown>) => Promise<void>;

function TechBadge() {
  return <View style={styles.diamond} />;
}

/** Not in a game: become a game tech (create or join), or see how sides get in. */
function NoGame({ busy, run }: { busy: boolean; run: Run }) {
  const g = useGame();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  return (
    <>
      <Card style={{ gap: 12 }}>
        <View style={styles.inline}>
          <TechBadge />
          <Text style={styles.title}>Игротех</Text>
        </View>
        <Text style={styles.text}>
          Ведёт большую игру: создаёт стороны и раздаёт коды их командирам, запускает матч, ставит режимы (захват
          территорий, флаги, тикеты, хотзона). Видит все стороны. Игротехов может быть несколько, у всех одинаковые
          права. На карте игротех — оранжевый ромб.
        </Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Название игры"
          placeholderTextColor={C.faint}
          maxLength={60}
          style={styles.input}
          selectionColor={C.accent}
        />
        <Button title="Создать игру" icon="plus" busy={busy} onPress={() => run(() => g.createGame(name))} />
      </Card>
      <Card style={{ gap: 12 }}>
        <Eyebrow>Уже есть игра</Eyebrow>
        <Text style={styles.text}>Код игротеха даёт создатель игры или любой из игротехов.</Text>
        <TextInput
          value={code}
          onChangeText={setCode}
          placeholder="Код игротеха"
          placeholderTextColor={C.faint}
          autoCapitalize="characters"
          maxLength={12}
          style={styles.input}
          selectionColor={C.accent}
        />
        <View style={styles.row}>
          <Button
            title="Войти"
            kind="secondary"
            style={{ flex: 1 }}
            busy={busy}
            onPress={() => run(() => g.joinAsTech(code))}
          />
          <Button title="QR" icon="qrcode-scan" kind="secondary" style={{ flex: 1 }} onPress={() => router.push('/scan')} />
        </View>
      </Card>
      <Card style={{ gap: 8 }}>
        <Eyebrow>Как устроено</Eyebrow>
        <Text style={styles.text}>
          Игротехи → командиры сторон → командиры отрядов → бойцы. Командир стороны подключает сторону к игре по коду
          игротеха «для сторон», командиры отрядов — свои отряды к стороне, как обычно.
        </Text>
      </Card>
    </>
  );
}

/** A side commander brings their side into a game. */
function AttachSide({ busy, run }: { busy: boolean; run: Run }) {
  const g = useGame();
  const [code, setCode] = useState('');
  return (
    <Card style={{ gap: 12 }}>
      <Eyebrow>Ваша сторона в игре</Eyebrow>
      <Text style={styles.text}>Введите код «для сторон», который дал игротех, или отсканируйте его QR.</Text>
      <TextInput
        value={code}
        onChangeText={setCode}
        placeholder="Код игры для сторон"
        placeholderTextColor={C.faint}
        autoCapitalize="characters"
        maxLength={12}
        style={styles.input}
        selectionColor={C.accent}
      />
      <View style={styles.row}>
        <Button title="Подключить" style={{ flex: 1 }} busy={busy} onPress={() => run(() => g.attachSide(code))} />
        <Button title="QR" icon="qrcode-scan" kind="secondary" style={{ flex: 1 }} onPress={() => router.push('/scan')} />
      </View>
    </Card>
  );
}

function PlayerView({ run }: { run: Run }) {
  const g = useGame();
  const side = useSide();
  const st = useMatch(g.game);
  const game = g.game!;
  return (
    <>
      <Card style={{ gap: 12 }}>
        <Eyebrow>Большая игра</Eyebrow>
        <Text style={styles.title}>{game.name}</Text>
        <Text style={styles.sub}>
          Ваша сторона: {g.sideName(g.mySideId)} · {matchText(st)}
        </Text>
        <GameScore />
      </Card>
      <Card style={{ gap: 8 }}>
        <Eyebrow>Игротехи · {g.techs.length}</Eyebrow>
        {g.techs.map((t) => (
          <View key={t.uid} style={styles.inline}>
            <TechBadge />
            <Text style={styles.text}>{t.callsign}</Text>
          </View>
        ))}
        <Text style={styles.sub}>На карте игротехи — оранжевые ромбы.</Text>
      </Card>
      <Rules />
      {side.isSideCommander && side.side?.gameId && (
        <Button
          title="Вывести сторону из игры"
          kind="danger"
          onPress={() =>
            confirmDestructive('Вывести сторону из игры?', 'Стороне перестанут идти очки и тикеты.', 'Вывести', () =>
              run(() => g.detachSide(side.side!.id))
            )
          }
        />
      )}
    </>
  );
}

function Rules() {
  return (
    <Card style={{ gap: 8 }}>
      <Eyebrow>Режимы</Eyebrow>
      <Text style={styles.text}>
        <Text style={styles.bold}>Захват территорий.</Text> Полигон разделён на 9 территорий. Сторона, чьих живых
        бойцов в территории больше 3 минуты подряд, захватывает её. Поровну — территория оспаривается, отсчёт стоит.
        Когда матч закончится, побеждает сторона с большим числом территорий.
      </Text>
      <Text style={styles.text}>
        <Text style={styles.bold}>Флаги.</Text> Захват без кнопок: чьих живых бойцов в 15 м от флага больше 30
        секунд подряд — того и флаг. Сторона получает очко за каждую минуту удержания.
      </Text>
      <Text style={styles.text}>
        <Text style={styles.bold}>Тикеты.</Text> У стороны ограниченное число жизней, каждое «Я убит» отнимает одну.
        Включаются отдельно и работают вместе с любым режимом.
      </Text>
      <Text style={styles.text}>
        <Text style={styles.bold}>Хотзона.</Text> Минута в зоне контроля — 1 очко стороне, в хотзоне — 2.
      </Text>
      <Text style={styles.text}>
        <Text style={styles.bold}>Конвой.</Text> Проведите конвой «с грузом» по маршруту через чекпойнты на базу
        противника. Каждый свой боец в 10 м от конвоя даёт 10 м/мин (учитываются до 5 бойцов перевеса), каждый
        противник рядом отнимает одного: трое против одного — 20 м/мин, поровну или противников больше — конвой стоит,
        назад он не едет. Доставили на базу — победа. По времени побеждает тот, кто прошёл больше чекпойнтов, потом —
        большую часть маршрута. Если конвой один и не доехал, побеждают обороняющиеся.
      </Text>
    </Card>
  );
}

function InviteBlock({ title, text, invite }: { title: string; text: string; invite: Invite }) {
  const [copied, setCopied] = useState(false);
  const link = inviteUrl(invite);
  return (
    <View style={{ gap: 10, alignItems: 'center' }}>
      <Text style={[styles.bold, { alignSelf: 'stretch' }]}>{title}</Text>
      <QrCode value={link} size={180} />
      <Text style={styles.sub}>{text}</Text>
      {invite.kind !== 'claim' && (
        <Text style={styles.code} selectable>
          {invite.code}
        </Text>
      )}
      <View style={styles.row}>
        {invite.kind !== 'claim' && (
          <Button
            title={copied ? 'Скопировано' : 'Код'}
            icon={copied ? 'check' : 'content-copy'}
            kind="secondary"
            style={{ flex: 1 }}
            onPress={() => {
              Clipboard.setStringAsync(invite.code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          />
        )}
        <Button
          title="Отправить"
          icon="share-variant"
          style={{ flex: 1 }}
          onPress={() => Share.share({ message: `${title} в GrimMap\n${link}` })}
        />
      </View>
    </View>
  );
}

function Chips<T extends string | number>({
  values,
  value,
  label,
  onPick,
}: {
  values: T[];
  value: T;
  label: (v: T) => string;
  onPick: (v: T) => void;
}) {
  return (
    <View style={styles.chips}>
      {values.map((v) => (
        <Pressable
          key={String(v)}
          onPress={() => {
            tap();
            onPick(v);
          }}
          style={[styles.chip, v === value && styles.chipOn]}
        >
          <Text style={[styles.chipText, v === value && { color: C.accentInk }]}>{label(v)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function TechView({ busy, run }: { busy: boolean; run: Run }) {
  const g = useGame();
  const session = useSession();
  const st = useMatch(g.game);
  const game = g.game!;
  const [minutesText, setMinutesText] = useState('20');
  const [sideName, setSideName] = useState('');
  const [invite, setInvite] = useState<'tech' | 'side' | null>(null);
  const [claimFor, setClaimFor] = useState<Side | null>(null);
  const count = (k: GamePlace) => g.markers.filter((m) => (k === 'hotzone' ? Boolean(m.zone) : m.kind === k)).length;
  const territories = count('sector');
  const placed = MODES.some((m) => count(m.k) > 0);
  const ready = placed || game.tickets != null;
  const minutes = Number(minutesText.replace(',', '.'));
  const minutesOk = Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440;

  const place = (k: GamePlace) => {
    if (k === 'ball' && !g.sides.length) {
      Alert.alert('Сначала стороны', 'Конвой едет за сторону: создайте хотя бы одну сторону (шаг 1).');
      return;
    }
    g.requestPlace(k);
    router.navigate('/');
  };

  return (
    <>
      <Card style={{ gap: 12 }}>
        <View style={styles.inline}>
          <TechBadge />
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{game.name}</Text>
            <Text style={styles.sub}>
              Вы игротех · {g.techs.length} игротех. · {g.sides.length} стор.
            </Text>
          </View>
        </View>
        <GameScore />
      </Card>

      <Card style={{ gap: 12 }}>
        <Eyebrow>Шаг 1 · Стороны · {g.sides.length}</Eyebrow>
        <Text style={styles.sub}>Создайте стороны и отправьте командирам код — они подключат свои отряды.</Text>
        {g.sides.map((s) => {
          const doc = g.sideDocs.find((d) => d.id === s.id);
          return (
            <SideRow
              key={s.id}
              s={s}
              pending={Boolean(doc?.claim)}
              mine={doc?.ownerId === session.uid}
              onColor={(color) => run(() => g.saveSide({ ...s, color }))}
              onInvite={() => doc && setClaimFor(doc)}
              onDrop={() =>
                confirmDestructive(`Убрать «${s.name}» из игры?`, 'Её бойцы перестанут получать очки.', 'Убрать', () =>
                  run(() => g.detachSide(s.id))
                )
              }
            />
          );
        })}
        {claimFor?.claim && (
          <InviteBlock
            title={`Командир стороны «${claimFor.name}»`}
            text="Командир сканирует код — сторона становится его, дальше он подключает к ней отряды."
            invite={{ kind: 'claim', code: claimFor.claim, sideId: claimFor.id }}
          />
        )}
        <TextInput
          value={sideName}
          onChangeText={setSideName}
          placeholder="Новая сторона, например «Синие»"
          placeholderTextColor={C.faint}
          maxLength={40}
          style={styles.input}
          selectionColor={C.accent}
        />
        <Button
          title="Создать сторону"
          icon="flag-plus"
          busy={busy}
          onPress={() =>
            run(async () => {
              if (!sideName.trim()) throw new Error('Введите название стороны');
              const s = await g.createSide(sideName.trim());
              setSideName('');
              setClaimFor(s);
            })
          }
        />
        <Button
          title={invite === 'side' ? 'Скрыть код для сторон' : 'Код для готовых сторон'}
          kind="secondary"
          icon="qrcode"
          onPress={() => setInvite(invite === 'side' ? null : 'side')}
        />
        {invite === 'side' && (
          <InviteBlock
            title="Сторона в игру"
            text="Для командира, который сам создал сторону: он сканирует код, и сторона входит в игру."
            invite={{ kind: 'gameside', code: game.sideCode }}
          />
        )}
      </Card>

      <Card style={{ gap: 12 }}>
        <Eyebrow>Шаг 2 · Режимы на карте</Eyebrow>
        <Text style={styles.sub}>
          Выберите режим и нажмите «Поставить» — откроется карта, наведите перекрестие на место. Режимы можно совмещать.
        </Text>
        {MODES.map((m) => {
          const n = count(m.k);
          return (
            <View key={m.k} style={styles.mode}>
              <View style={[styles.modeIcon, { borderColor: m.color }]}>
                <Icon name={m.icon} size={20} color={m.color} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.bold}>{m.title}</Text>
                <Text style={styles.sub}>{m.desc}</Text>
                <Text style={[styles.sub, { color: n ? C.accent : C.faint }]}>{n ? m.done(n) : 'не поставлено'}</Text>
              </View>
              <View style={{ gap: 6 }}>
                <Button
                  title={n && (m.k === 'sector' || m.k === 'ball') ? 'Заново' : n ? 'Ещё' : 'Поставить'}
                  kind={n ? 'secondary' : 'primary'}
                  onPress={() => place(m.k)}
                />
                {n > 0 && (
                  <Button
                    title="Убрать"
                    kind="ghost"
                    onPress={() =>
                      confirmDestructive(`Убрать: ${m.title}?`, 'Объекты режима исчезнут с карты у всех.', 'Убрать', () =>
                        run(() => g.removeMode(m.k))
                      )
                    }
                  />
                )}
              </View>
            </View>
          );
        })}
        <View style={styles.mode}>
          <View style={[styles.modeIcon, { borderColor: C.danger }]}>
            <Icon name="heart-multiple-outline" size={20} color={C.danger} />
          </View>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={styles.bold}>Жизни сторон (тикеты)</Text>
            <Text style={styles.sub}>
              Без точек на карте: у каждой стороны запас жизней, каждое «Я убит» отнимает одну. В счёте видно, сколько
              осталось. Можно вместе с любым режимом.
            </Text>
            <TicketsInput value={game.tickets ?? null} onSave={(n) => run(() => g.setTickets(n))} />
          </View>
        </View>
      </Card>

      <Card style={{ gap: 12 }}>
        <Eyebrow>Шаг 3 · Время и старт</Eyebrow>
        <Text style={[styles.title, { fontSize: 18 }]}>{matchText(st)}</Text>
        {st.phase === 'running' ? (
          <Button
            title="Остановить матч"
            kind="danger"
            icon="stop"
            onPress={() =>
              confirmDestructive('Остановить матч?', 'Время матча закончится сейчас, итог зафиксируется.', 'Остановить', () =>
                run(() => g.stopMatch())
              )
            }
          />
        ) : (
          <>
            <View style={styles.inline}>
              <TextInput
                value={minutesText}
                onChangeText={(t) => setMinutesText(t.replace(/[^0-9]/g, '').slice(0, 4))}
                keyboardType="number-pad"
                maxLength={4}
                style={[styles.input, styles.minutes]}
                selectionColor={C.accent}
              />
              <Text style={styles.text}>минут</Text>
            </View>
            <Chips
              values={MATCH_MINUTES}
              value={minutesOk ? minutes : -1}
              label={(m) => `${m}`}
              onPick={(m) => setMinutesText(String(m))}
            />
            {territories > 0 && (
              <>
                <Text style={styles.sub}>Если территорий поровну:</Text>
                <Chips
                  values={['draw', 'time'] as ('draw' | 'time')[]}
                  value={game.tiebreak}
                  label={(t) => (t === 'draw' ? 'ничья' : 'кто дольше держал')}
                  onPick={(t) => run(() => g.setTiebreak(t))}
                />
              </>
            )}
            {!ready && (
              <Text style={[styles.sub, { color: C.warn }]}>
                Сначала шаг 2: поставьте на карте хотя бы один режим или включите тикеты — иначе считать нечего.
              </Text>
            )}
            <Button
              title={minutesOk ? `Старт · ${minutes} мин` : 'Укажите минуты (1–1440)'}
              icon="play"
              busy={busy}
              disabled={!ready || !minutesOk}
              onPress={() =>
                confirmDestructive(
                  'Запустить матч?',
                  `У всех игроков пойдёт отсчёт ${minutes} мин.${territories ? ' Захват территорий начнётся с нуля.' : ''}`,
                  'Старт',
                  () =>
                    run(async () => {
                      if (territories) await g.resetTerritory();
                      await g.startMatch(minutes);
                    })
                )
              }
            />
          </>
        )}
        <Text style={styles.sub}>
          Территории, флаги и конвой считает телефон игротеха: держите приложение открытым и с интернетом, пока идёт
          матч.
        </Text>
      </Card>

      <Card style={{ gap: 12 }}>
        <Eyebrow>Игротехи · {g.techs.length}</Eyebrow>
        {g.techs.map((t) => (
          <View key={t.uid} style={styles.inline}>
            <TechBadge />
            <Text style={[styles.text, { flex: 1 }]}>
              {t.callsign}
              {t.uid === game.ownerId ? ' · создатель' : ''}
              {t.uid === session.uid ? ' · вы' : ''}
            </Text>
            {g.isCreator && t.uid !== session.uid && (
              <Pressable
                hitSlop={8}
                onPress={() =>
                  confirmDestructive(`Убрать игротеха ${t.callsign}?`, '', 'Убрать', () => run(() => g.removeTech(t.uid)))
                }
              >
                <Icon name="account-remove-outline" size={20} color={C.dim} />
              </Pressable>
            )}
          </View>
        ))}
        <Button
          title={invite === 'tech' ? 'Скрыть код игротеха' : 'Добавить игротеха'}
          kind="secondary"
          icon="account-plus-outline"
          onPress={() => setInvite(invite === 'tech' ? null : 'tech')}
        />
        {invite === 'tech' && (
          <InviteBlock
            title="Игротех"
            text="С этим кодом человек становится игротехом с теми же правами, что у вас."
            invite={{ kind: 'game', code: game.techCode }}
          />
        )}
      </Card>

      <Card style={styles.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.bold}>{g.showAll ? 'Все бойцы' : 'Только командиры'}</Text>
          <Text style={styles.sub}>Кого из сторон показывать на вашей карте</Text>
        </View>
        <Switch
          value={g.showAll}
          onValueChange={(v) => g.setShowAll(v)}
          trackColor={{ true: C.accent, false: C.elevated }}
          thumbColor="#fff"
        />
      </Card>

      <Rules />

      <Button
        title="Выйти из игротехов"
        kind="danger"
        icon="logout"
        onPress={() =>
          confirmDestructive('Выйти из игротехов?', 'Вернуться можно по коду игротеха.', 'Выйти', () => run(() => g.leave()))
        }
      />
    </>
  );
}

/** Lives per side: any number, or off. */
function TicketsInput({ value, onSave }: { value: number | null; onSave: (n: number | null) => void }) {
  const [text, setText] = useState(value ? String(value) : '');
  const n = Number(text);
  const dirty = (text ? n : null) !== value;
  return (
    <View style={styles.inline}>
      <TextInput
        value={text}
        onChangeText={(t) => setText(t.replace(/[^0-9]/g, '').slice(0, 5))}
        placeholder="выкл"
        placeholderTextColor={C.faint}
        keyboardType="number-pad"
        maxLength={5}
        style={[styles.input, styles.minutes]}
        selectionColor={C.accent}
      />
      {dirty ? (
        <Button title={text && n > 0 ? 'Сохранить' : 'Выключить'} kind="secondary" onPress={() => onSave(text && n > 0 ? n : null)} />
      ) : (
        <Text style={styles.sub}>{value ? 'жизней у каждой стороны' : 'выключены'}</Text>
      )}
    </View>
  );
}

const MODES: { k: GamePlace; title: string; desc: string; icon: IconName; color: string; done: (n: number) => string }[] = [
  {
    k: 'sector',
    title: 'Захват территорий',
    desc: 'Поле 3×3. Территорию берёт сторона, у которой там больше живых бойцов 3 минуты подряд.',
    icon: 'hexagon-outline',
    color: '#FFC83D',
    done: () => 'поле размечено',
  },
  {
    k: 'flag',
    title: 'Флаги',
    desc: 'Захват сам: больше своих бойцов в 15 м от флага 30 секунд. Очко за минуту удержания.',
    icon: 'flag',
    color: '#FF8A3D',
    done: (n) => `флагов: ${n}`,
  },
  {
    k: 'hotzone',
    title: 'Хотзона',
    desc: 'Большой круг, внутри переезжает горячий. Минута в зоне — 1 очко, в хотзоне — 2.',
    icon: 'fire',
    color: '#FF5A1F',
    done: (n) => `зон: ${n}`,
  },
  {
    k: 'ball',
    title: 'Конвой',
    desc: 'Маршрут через чекпойнты на базу противника. Едет, пока своих рядом больше, чем чужих.',
    icon: 'truck',
    color: '#3D9BFF',
    done: (n) => `конвоев: ${n}`,
  },
];

function SideRow({
  s,
  pending,
  mine,
  onColor,
  onInvite,
  onDrop,
}: {
  s: GameSide;
  pending: boolean;
  mine: boolean;
  onColor: (c: string) => void;
  onInvite: () => void;
  onDrop: () => void;
}) {
  return (
    <View style={styles.sideRow}>
      <View style={styles.inline}>
        <View style={[styles.dot, { backgroundColor: s.color }]} />
        <Text style={[styles.bold, { flex: 1 }]} numberOfLines={1}>
          {s.name}
        </Text>
        {pending && mine && (
          <Pressable hitSlop={8} onPress={onInvite} accessibilityLabel="Пригласить командира">
            <Icon name="qrcode" size={20} color={C.warn} />
          </Pressable>
        )}
        <Pressable hitSlop={8} onPress={onDrop} accessibilityLabel="Убрать из игры">
          <Icon name="close" size={20} color={C.dim} />
        </Pressable>
      </View>
      {pending && <Text style={styles.sub}>Командир ещё не принял сторону: покажите ему QR</Text>}
      <View style={styles.chips}>
        {SIDE_COLORS.map((c) => (
          <Pressable
            key={c}
            onPress={() => onColor(c)}
            style={[styles.color, { backgroundColor: c }, c === s.color && { borderColor: C.text }]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mode: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 6 },
  modeIcon: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  minutes: { width: 90, textAlign: 'center', fontSize: 18 },
  content: { padding: 16, gap: 14, paddingBottom: 48, width: '100%', maxWidth: 640, alignSelf: 'center' },
  title: { color: C.text, fontSize: 22, fontFamily: F.bold },
  text: { color: C.text, fontSize: 14, fontFamily: F.regular, lineHeight: 20 },
  bold: { color: C.text, fontSize: 15, fontFamily: F.semibold },
  sub: { color: C.dim, fontSize: 13, fontFamily: F.regular, lineHeight: 18 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  row: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
  input: {
    backgroundColor: C.elevated,
    color: C.text,
    borderRadius: R.md,
    paddingHorizontal: 14,
    height: 50,
    borderWidth: 1,
    borderColor: C.line,
    fontSize: 16,
    fontFamily: F.regular,
  },
  code: { color: C.accent, fontFamily: F.mono, fontSize: 26, letterSpacing: 4 },
  diamond: {
    width: 14,
    height: 14,
    backgroundColor: TECH_COLOR,
    transform: [{ rotate: '45deg' }],
    marginHorizontal: 3,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    height: 34,
    borderRadius: R.sm,
    borderWidth: 1,
    borderColor: C.lineStrong,
    backgroundColor: C.elevated,
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: C.accent, borderColor: C.accent },
  chipText: { color: C.text, fontFamily: F.semibold, fontSize: 13 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sideRow: { gap: 8, padding: 10, borderRadius: R.md, backgroundColor: C.elevated },
  dot: { width: 12, height: 12, borderRadius: 6 },
  color: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: 'transparent' },
});
