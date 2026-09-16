import 'package:flutter_test/flutter_test.dart';
import 'package:medpin/features/medications/domain/strength.dart';

void main() {
  test('adds a unit only to bare numbers', () {
    expect(formatStrength('500'), '500 mg');
    expect(formatStrength('12.5'), '12.5 mg');
    expect(formatStrength('500/50'), '500/50 mg');
    expect(formatStrength('500 / 50'), '500/50 mg');
  });

  test('tidies spacing when the unit is already there', () {
    expect(formatStrength('1mg'), '1 mg');
    expect(formatStrength('500 mg'), '500 mg');
    expect(formatStrength('100IU'), '100 IU');
    expect(formatStrength('12.5mcg'), '12.5 mcg');
  });

  test('never touches a value that states its own unit', () {
    expect(formatStrength('100 IU/mL'), '100 IU/mL');
    expect(formatStrength('1/2 tablet'), '1/2 tablet');
    expect(formatStrength('as directed'), 'as directed');
  });

  test('empty stays empty', () {
    expect(formatStrength(''), '');
    expect(formatStrength(null), '');
    expect(formatStrength('   '), '');
  });

  test('flags only the values where a unit was assumed', () {
    expect(strengthAssumesUnit('500'), isTrue);
    expect(strengthAssumesUnit('500/50'), isTrue);
    expect(strengthAssumesUnit('1mg'), isFalse);
    expect(strengthAssumesUnit('100 IU/mL'), isFalse);
  });
}
