import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/tokens.dart';
import '../../data/practice_repository.dart';
import '../../domain/practice.dart';

/// Fill in what the letterhead is missing.
///
/// A sheet rather than a screen, and only the fields that are actually absent.
/// A full edit form would show a doctor six inputs when five are already
/// correct, and the one that matters would be somewhere in the middle of them.
///
/// The logo is not here on purpose: it is an upload with cropping and a
/// light/dark decision, which is a screen's worth of work and never the thing
/// blocking a prescription.
class PracticeDetailsSheet extends ConsumerStatefulWidget {
  const PracticeDetailsSheet({super.key, required this.practice});

  final PracticeOverview practice;

  @override
  ConsumerState<PracticeDetailsSheet> createState() => _PracticeDetailsSheetState();
}

class _PracticeDetailsSheetState extends ConsumerState<PracticeDetailsSheet> {
  final _formKey = GlobalKey<FormState>();
  late final Map<String, TextEditingController> _controllers;
  bool _saving = false;
  String? _error;

  /// The text fields this sheet knows how to edit, in letterhead order.
  ///
  /// The hints are the shape of an answer, not somebody's answer. They were one
  /// real clinic's name and its doctor's, shown as the example to every other
  /// practice's doctor filling in their own letterhead.
  static const _editable = <String, ({String label, String hint})>{
    'name': (label: 'Practice name', hint: 'e.g. City Diabetes Clinic'),
    'doctorDisplayName': (label: 'Doctor’s printed name', hint: 'As it should print, e.g. Dr. A. Sharma'),
    'registrationNo': (label: 'Registration number', hint: 'e.g. WBMC-12345'),
    'tagline': (label: 'Tagline', hint: 'e.g. Diabetes & Endocrine Care'),
  };

  @override
  void initState() {
    super.initState();
    final p = widget.practice;
    final current = <String, String?>{
      'name': p.name,
      'doctorDisplayName': p.doctorDisplayName,
      'registrationNo': p.registrationNo,
      'tagline': p.tagline,
    };
    _controllers = {
      for (final key in _editable.keys)
        key: TextEditingController(text: current[key] ?? ''),
    };
  }

  @override
  void dispose() {
    for (final c in _controllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  /// Which fields the server said are blocking, so they can be marked required
  /// here rather than duplicating the clinical rule in the client.
  Set<String> get _blockingKeys =>
      widget.practice.blockingGaps.map((g) => g.key).toSet();

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;

    setState(() {
      _saving = true;
      _error = null;
    });

    final changes = <String, dynamic>{};
    for (final entry in _controllers.entries) {
      final value = entry.value.text.trim();
      changes[entry.key] = value.isEmpty ? null : value;
    }
    // Never null: the server requires a minimum length, and clearing the name
    // would leave the letterhead with no top line.
    if ((changes['name'] as String?) == null) changes.remove('name');

    try {
      await ref
          .read(practiceRepositoryProvider)
          .update(widget.practice.id, changes);
      ref.invalidate(practiceOverviewProvider);
      if (mounted) Navigator.of(context).pop(true);
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = 'Could not save. Check the connection and try again — nothing was changed.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final insets = MediaQuery.viewInsetsOf(context).bottom;

    return Padding(
      padding: EdgeInsets.only(bottom: insets),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(T.s4, 0, T.s4, T.s6),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('Letterhead details', style: T.title.copyWith(color: T.ink)),
              const SizedBox(height: T.s1),
              Text(
                'What prints at the top of every prescription.',
                style: T.small.copyWith(color: T.inkMuted),
              ),
              const SizedBox(height: T.s6),

              for (final entry in _editable.entries) ...[
                _Field(
                  controller: _controllers[entry.key]!,
                  label: entry.value.label,
                  hint: entry.value.hint,
                  required: _blockingKeys.contains(entry.key),
                ),
                const SizedBox(height: T.s4),
              ],

              if (_error != null) ...[
                Text(_error!, style: T.small.copyWith(color: T.danger)),
                const SizedBox(height: T.s4),
              ],

              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: _saving ? null : _save,
                  child:
                      _saving
                          ? const SizedBox(
                            height: 18,
                            width: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                          : const Text('Save'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Field extends StatelessWidget {
  const _Field({
    required this.controller,
    required this.label,
    required this.hint,
    required this.required,
  });

  final TextEditingController controller;
  final String label;
  final String hint;
  final bool required;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      textCapitalization: TextCapitalization.words,
      decoration: InputDecoration(
        labelText: required ? '$label *' : label,
        hintText: hint,
      ),
      validator: (v) {
        if (!required) return null;
        return (v?.trim().isEmpty ?? true) ? 'Needed on the prescription' : null;
      },
    );
  }
}
