import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TECH_COLOR } from '../lib/gameModes';
import { useGame } from '../state/game';

import { Card, Icon, tap } from './components';
import { GameScore } from './GameScore';
import { C, F } from './theme';

/** «Большая игра» on the squad screen: the game I'm in, or the way to join or run one. */
export function GameLinkCard() {
  const g = useGame();
  return (
    <Pressable
      onPress={() => {
        tap();
        router.push('/game');
      }}
    >
      <Card style={{ gap: 10 }}>
        <View style={styles.head}>
          <View style={[styles.diamond, { borderColor: g.isTech ? TECH_COLOR : C.dim }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>
              {g.game ? g.game.name : 'Большая игра'}
            </Text>
            <Text style={styles.sub} numberOfLines={2}>
              {g.game
                ? g.isTech
                  ? 'Вы игротех: режимы, стороны, матч'
                  : `Ваша сторона: ${g.sideName(g.mySideId)}`
                : 'Игры с игротехами: стороны, захват территорий, флаги, хотзона, конвой, тикеты'}
            </Text>
          </View>
          <Icon name="chevron-right" size={22} color={C.faint} />
        </View>
        {g.game && <GameScore compact />}
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  diamond: { width: 16, height: 16, borderWidth: 2.5, transform: [{ rotate: '45deg' }], marginHorizontal: 4 },
  title: { color: C.text, fontSize: 16, fontFamily: F.semibold },
  sub: { color: C.dim, fontSize: 13, fontFamily: F.regular, lineHeight: 18 },
});
