import { Modal, Pressable, StyleSheet } from 'react-native';
import LottieView from 'lottie-react-native';
import { useStyles, type ThemeColors } from '@components/design-system';

const celebrationAnimation = require('../../assets/LottieSamples/thumbsup.json');

interface TaskCelebrationOverlayProps {
  visible: boolean;
  onDismiss: () => void;
}

/** Full-screen celebration shown after a successful task redeem — tap anywhere to dismiss. */
export function TaskCelebrationOverlay({ visible, onDismiss }: TaskCelebrationOverlayProps) {
  const styles = useStyles(makeStyles);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <LottieView source={celebrationAnimation} autoPlay loop style={styles.animation} />
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
