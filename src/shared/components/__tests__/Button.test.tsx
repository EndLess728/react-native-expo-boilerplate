import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import Button from '../Button';

// A styled component rendering at all is the point: it proves the style layer
// (Unistyles' mock, plain StyleSheet or Uniwind) loads under Jest.
describe('Button', () => {
  it('renders its title and handles a press', () => {
    const onPress = jest.fn();
    render(<Button title="Save" onPress={onPress} />);

    fireEvent.press(screen.getByText('Save'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('shows a spinner instead of the title while loading', () => {
    const onPress = jest.fn();
    render(<Button isLoading title="Save" onPress={onPress} />);

    expect(screen.queryByText('Save')).toBeNull();
  });
});
