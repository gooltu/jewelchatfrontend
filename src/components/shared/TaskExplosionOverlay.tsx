import { Modal, Pressable, StyleSheet } from 'react-native';
import LottieView from 'lottie-react-native';
import { useStyles, type ThemeColors } from '@components/design-system';

const explosionAnimation = require('../../assets/LottieSamples/bombexplosion.json');

interface TaskExplosionOverlayProps {
  visible: boolean;
  onDismiss: () => void;
}

/** Full-screen animation shown when a bomb task explodes — tap anywhere to dismiss. */
export function TaskExplosionOverlay({ visible, onDismiss }: TaskExplosionOverlayProps) {
  const styles = useStyles(makeStyles);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <LottieView source={explosionAnimation} autoPlay loop style={styles.animation} />
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: colors.backdrop,
      alignItems: 'center',
      justifyContent: 'center',
    },
    animation: {
      width: '80%',
      aspectRatio: 1,
    },
  });
