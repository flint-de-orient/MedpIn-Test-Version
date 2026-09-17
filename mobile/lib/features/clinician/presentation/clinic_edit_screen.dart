import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/tokens.dart';
import '../../appointments/data/clinic_repository.dart';
import '../../appointments/domain/clinic.dart';
import '../../appointments/domain/doctor_hours.dart';
import '../../appointments/presentation/appointment_providers.dart';
import '../../appointments/presentation/doctor_hours_screen.dart';
import '../../appointments/presentation/widgets/still_booked_dialog.dart';
import '../../../shared/widgets/surfaces.dart';
import '../../../shared/widgets/authed_image.dart';
import '../../../shared/data/upload_repository.dart';
import '../../../shared/data/care_contact.dart';
import 'package:image_picker/image_picker.dart';
import '../../../shared/widgets/error_view.dart';

const _weekOrder = [1, 2, 3, 4, 5, 6, 0]; // Mon … Sun
const _dayNames = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/// Create or edit a clinic: its details, slot length, weekly availability
/// windows and one-off closures. Doctor + staff.
class ClinicEditScreen extends ConsumerStatefulWidget {
  const ClinicEditScreen({super.key, this.clinic});

  final Clinic? clinic;

  @override
  ConsumerState<ClinicEditScreen> createState() => _ClinicEditScreenState();
}

class _ClinicEditScreenState extends ConsumerState<ClinicEditScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _name;
  late final TextEditingController _address;
  late final TextEditingController _city;
  late final TextEditingController _phone;
  late final TextEditingController _mapUrl;
  late final TextEditingController _altPhone;
  late final TextEditingController _tagline;
  late final TextEditingController _doctorName;
  late final TextEditingController _registrationNo;

  /// The uploaded mark, and whether it needs a dark ground behind it.
  String? _logoLightUrl;
  String? _logoAssetId;
  bool _logoNeedsDarkChip = false;
  bool _uploadingLogo = false;

  int _slotMinutes = 15;
  bool _isActive = true;
  late List<WeeklyHour> _weekly;
  late List<ClinicOverride> _overrides;
  bool _saving = false;

  bool get _editing => widget.clinic != null;

  @override
  void initState() {
    super.initState();
    final c = widget.clinic;
    _name = TextEditingController(text: c?.name ?? '');
    _address = TextEditingController(text: c?.addressLine ?? '');
    _city = TextEditingController(text: c?.city ?? '');
    _phone = TextEditingController(text: c?.phone ?? '');
    _mapUrl = TextEditingController(text: c?.mapUrl ?? '');
    _altPhone = TextEditingController(text: c?.altPhone ?? '');
    _tagline = TextEditingController(text: c?.tagline ?? '');
    _doctorName = TextEditingController(text: c?.doctorDisplayName ?? '');
    _registrationNo = TextEditingController(text: c?.registrationNo ?? '');
    _logoLightUrl = c?.logoLightUrl;
    _logoNeedsDarkChip = c?.logoNeedsDarkChip ?? false;
    _slotMinutes = c?.slotMinutes ?? 15;
    _isActive = c?.isActive ?? true;
    _weekly = [...?c?.weeklyHours];
    _overrides = [...?c?.overrides];
  }

  @override
  void dispose() {
    _name.dispose();
    _address.dispose();
    _city.dispose();
    _phone.dispose();
    _mapUrl.dispose();
    _altPhone.dispose();
    _tagline.dispose();
    _doctorName.dispose();
    _registrationNo.dispose();
    super.dispose();
  }

  String _fmt(TimeOfDay t) =>
      '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

  Future<void> _addWindow(int day) async {
    final start = await showTimePicker(
      context: context,
      initialTime: const TimeOfDay(hour: 10, minute: 0),
      helpText: 'Start time',
    );
    if (start == null || !mounted) return;
    final end = await showTimePicker(
      context: context,
      initialTime: TimeOfDay(hour: (start.hour + 1) % 24, minute: start.minute),
      helpText: 'End time',
    );
    if (end == null || !mounted) return;
    final s = _fmt(start);
    final e = _fmt(end);
    if (e.compareTo(s) <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('End time must be after the start time')),
      );
      return;
    }
    setState(() => _weekly.add(WeeklyHour(dayOfWeek: day, start: s, end: e)));
  }

  void _removeWindow(WeeklyHour w) {
    setState(() => _weekly.remove(w));
  }

  Future<void> _addClosure() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: now,
      firstDate: now,
      lastDate: DateTime(now.year + 1),
      helpText: 'Closed on',
    );
    if (picked == null) return;
    final date = DateFormat('yyyy-MM-dd').format(picked);
    if (_overrides.any((o) => o.date == date)) return;
    setState(() => _overrides.add(ClinicOverride(date: date, isClosed: true)));
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    setState(() => _saving = true);

    final body = {
      'name': _name.text.trim(),
      'addressLine': _address.text.trim(),
      'city': _city.text.trim(),
      'phone': _phone.text.trim(),
      'altPhone': _altPhone.text.trim(),
      'mapUrl': _mapUrl.text.trim(),
      'tagline': _tagline.text.trim(),
      'doctorDisplayName': _doctorName.text.trim(),
      'registrationNo': _registrationNo.text.trim(),
      // Only when a new one was picked this session — sending null would clear
      // a logo the doctor never touched.
      if (_logoAssetId != null) 'logoLightAssetId': _logoAssetId,
      if (_logoAssetId != null) 'logoNeedsDarkChip': _logoNeedsDarkChip,
      'slotMinutes': _slotMinutes,
      'weeklyHours': _weekly.map((w) => w.toJson()).toList(),
      'overrides': _overrides.map((o) => o.toJson()).toList(),
      'isActive': _isActive,
    };

    try {
      final repo = ref.read(clinicRepositoryProvider);
      StillBooked? stillBooked;
      if (_editing) {
        stillBooked = (await repo.update(widget.clinic!.id, body)).stillBooked;
      } else {
        await repo.create(body);
      }
      ref.invalidate(clinicsProvider);
      // A location's phone is what patients ring when the practice has one
      // location and no number of its own, so the contact is read again.
      ref.invalidate(careContactProvider);
      messenger.showSnackBar(const SnackBar(content: Text('Clinic saved')));
      // Switching "Accepting bookings" off closes the clinic; whoever is still
      // booked there is shown before the screen goes.
      if (stillBooked != null && !stillBooked.isEmpty && mounted) {
        await showStillBooked(context, _name.text.trim(), stillBooked);
      }
      navigator.pop();
    } on ApiException catch (e) {
      setState(() => _saving = false);
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  /// Pick a logo, upload it, and remember what the server made of it.
  ///
  /// The artwork is never altered. The server measures the mean luminance of
  /// the non-transparent pixels and says whether it was drawn for a dark
  /// background; if it was, the app paints a dark chip behind it. Inverting it
  /// instead would turn this clinic's teal orange, and colour is the part of a
  /// logo that carries the brand.
  Future<void> _pickLogo() async {
    final messenger = ScaffoldMessenger.of(context);
    final file = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      imageQuality: 100,
    );
    if (file == null) return;

    setState(() => _uploadingLogo = true);
    try {
      final asset = await ref
          .read(uploadRepositoryProvider)
          .uploadImage(
            path: file.path,
            filename: file.name,
            kind: UploadKind.clinicLogo,
          );
      if (!mounted) return;
      setState(() {
        _logoAssetId = asset.id;
        _logoLightUrl = asset.url;
        _logoNeedsDarkChip = asset.needsDarkChip;
      });
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            asset.needsDarkChip
                ? 'Logo added. It was drawn for a dark background, so it will '
                    'be shown on a dark panel.'
                : 'Logo added. Save to apply it.',
          ),
        ),
      );
    } catch (e) {
      // The reason, not just the fact.
      //
      // "Could not upload the logo" was all this said, for a picture too
      // large, a format the server will not take, an expired session and a
      // dead network alike — four different things to do about it, and no way
      // to tell which one you were looking at.
      if (!mounted) return;
      messenger.showSnackBar(
        SnackBar(
          content: Text(ErrorView.messageFor(context, e)),
          duration: const Duration(seconds: 6),
        ),
      );
    } finally {
      if (mounted) setState(() => _uploadingLogo = false);
    }
  }

  Future<void> _delete() async {
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder:
          (ctx) => AlertDialog(
            title: const Text('Deactivate clinic?'),
            // What actually happens, both halves: nothing new can land here,
            // and nothing already here is touched — so the patients still
            // booked here are the desk's to move, which nobody would know.
            content: const Text(
              'It will stop showing times and taking new bookings. Appointments '
              'already booked here are kept — move them to another clinic if '
              'those patients should still come.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Cancel'),
              ),
              TextButton(
                style: TextButton.styleFrom(foregroundColor: AppColors.danger),
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Deactivate'),
              ),
            ],
          ),
    );
    if (ok != true) return;
    try {
      final closed = await ref.read(clinicRepositoryProvider).deactivate(widget.clinic!.id);
      ref.invalidate(clinicsProvider);
      final still = closed.stillBooked;
      if (still != null && !still.isEmpty && mounted) {
        await showStillBooked(context, widget.clinic!.name, still);
      }
      navigator.pop();
    } on ApiException catch (e) {
      // The reason, when there is one worth reading: a location this person
      // does not manage is not something "try again" fixes.
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            e.code == 'LOCATION_NOT_MANAGED'
                ? e.message
                : 'Could not deactivate. Please try again.',
          ),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: Text(_editing ? 'Edit clinic' : 'Add clinic'),
        actions: [
          if (_editing)
            IconButton(
              icon: const Icon(Icons.delete_outline_rounded),
              tooltip: 'Deactivate',
              onPressed: _delete,
            ),
        ],
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.md,
            AppSpacing.md,
            AppSpacing.md,
            96,
          ),
          children: [
            TextFormField(
              controller: _name,
              decoration: const InputDecoration(labelText: 'Clinic name'),
              textCapitalization: TextCapitalization.words,
              validator:
                  (v) => (v == null || v.trim().isEmpty) ? 'Required' : null,
            ),
            const SizedBox(height: AppSpacing.md),
            TextFormField(
              controller: _address,
              decoration: const InputDecoration(labelText: 'Address'),
            ),
            const SizedBox(height: AppSpacing.md),
            Row(
              children: [
                Expanded(
                  child: TextFormField(
                    controller: _city,
                    decoration: const InputDecoration(labelText: 'City'),
                  ),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: TextFormField(
                    controller: _phone,
                    keyboardType: TextInputType.phone,
                    decoration: const InputDecoration(labelText: 'Phone'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.md),
            const SizedBox(height: AppSpacing.md),
            TextFormField(
              controller: _altPhone,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(
                labelText: 'Second phone',
                helperText: 'Also shown to patients. Optional.',
              ),
            ),

            const SizedBox(height: AppSpacing.lg),
            const _BrandHeading(),
            const SizedBox(height: AppSpacing.sm),
            TextFormField(
              controller: _tagline,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                labelText: 'Tagline',
                helperText: 'The line under the name on the letterhead.',
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            TextFormField(
              controller: _doctorName,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                labelText: 'Doctor name as printed',
                helperText: 'Not always the name on the account.',
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            TextFormField(
              controller: _registrationNo,
              decoration: const InputDecoration(
                labelText: 'Medical registration number',
                helperText: 'Printed under the signature.',
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            _LogoField(
              url: _logoLightUrl,
              needsDarkChip: _logoNeedsDarkChip,
              busy: _uploadingLogo,
              onPick: _pickLogo,
            ),

            const SizedBox(height: AppSpacing.lg),
            TextFormField(
              controller: _mapUrl,
              keyboardType: TextInputType.url,
              decoration: const InputDecoration(
                labelText: 'Map link (optional)',
              ),
            ),
            const SizedBox(height: AppSpacing.lg),

            // Slot length.
            Text(
              'Slot length',
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w700,
                color: scheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            Wrap(
              spacing: AppSpacing.sm,
              children: [
                for (final m in [10, 15, 20, 30, 45])
                  ChoiceChip(
                    label: Text('$m min'),
                    selected: _slotMinutes == m,
                    onSelected: (_) => setState(() => _slotMinutes = m),
                  ),
              ],
            ),
            const SizedBox(height: AppSpacing.md),
            SwitchListTile.adaptive(
              contentPadding: EdgeInsets.zero,
              value: _isActive,
              onChanged: (v) => setState(() => _isActive = v),
              title: const Text('Accepting bookings'),
              subtitle: const Text('Patients can book this clinic when on'),
            ),
            const Divider(height: AppSpacing.xl),

            // Weekly availability.
            const Text(
              'Weekly availability',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              'Set the times the doctor is available each day. Slots are generated inside these windows.',
              style: TextStyle(fontSize: 14, color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: AppSpacing.md),
            for (final day in _weekOrder)
              _DayEditor(
                dayName: _dayNames[day],
                windows:
                    (_weekly.where((w) => w.dayOfWeek == day).toList())
                      ..sort((a, b) => a.start.compareTo(b.start)),
                onAdd: () => _addWindow(day),
                onRemove: _removeWindow,
              ),

            // Each doctor's own hours here, where they differ from the clinic's.
            // Only for a clinic that exists: a diary belongs to a location.
            if (_editing) ...[
              const SizedBox(height: T.s2),
              Semantics(
                button: true,
                label: 'Doctors’ hours at this clinic',
                excludeSemantics: true,
                child: InnerTile(
                  onTap:
                      () => Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => DoctorHoursScreen(clinic: widget.clinic!),
                        ),
                      ),
                  child: Row(
                    children: [
                      Icon(Icons.badge_outlined, color: scheme.onSurfaceVariant),
                      const SizedBox(width: T.s3),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Doctors’ hours here', style: T.bodyStrong),
                            Text(
                              'A doctor who sits here on other days or times than the clinic’s',
                              style: T.small.copyWith(color: scheme.onSurfaceVariant),
                            ),
                          ],
                        ),
                      ),
                      Icon(Icons.chevron_right_rounded, color: scheme.outline),
                    ],
                  ),
                ),
              ),
            ],
            const Divider(height: AppSpacing.xl),

            // Closures.
            Row(
              children: [
                const Expanded(
                  child: Text(
                    'Closures & holidays',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
                  ),
                ),
                TextButton.icon(
                  onPressed: _addClosure,
                  icon: const Icon(Icons.add_rounded, size: 18),
                  label: const Text('Add'),
                ),
              ],
            ),
            if (_overrides.isEmpty)
              Text(
                'No closures set',
                style: TextStyle(fontSize: 14, color: scheme.onSurfaceVariant),
              )
            else
              Wrap(
                spacing: AppSpacing.sm,
                runSpacing: AppSpacing.sm,
                children: [
                  for (final o in _overrides.where((o) => o.isClosed))
                    InputChip(
                      label: Text(
                        DateFormat('d MMM yyyy').format(DateTime.parse(o.date)),
                      ),
                      onDeleted: () => setState(() => _overrides.remove(o)),
                    ),
                ],
              ),
          ],
        ),
      ),
      bottomSheet: Container(
        padding: EdgeInsets.fromLTRB(
          AppSpacing.md,
          AppSpacing.sm,
          AppSpacing.md,
          AppSpacing.md + MediaQuery.of(context).padding.bottom,
        ),
        decoration: BoxDecoration(
          color: scheme.surface,
          border: Border(top: BorderSide(color: scheme.outlineVariant)),
        ),
        child: SizedBox(
          width: double.infinity,
          height: 52,
          child: FilledButton(
            onPressed: _saving ? null : _save,
            child:
                _saving
                    ? const SizedBox(
                      width: 20,
                      height: 22,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.4,
                        color: Colors.white,
                      ),
                    )
                    : Text(
                      _editing ? 'Save changes' : 'Create clinic',
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
          ),
        ),
      ),
    );
  }
}

class _DayEditor extends StatelessWidget {
  const _DayEditor({
    required this.dayName,
    required this.windows,
    required this.onAdd,
    required this.onRemove,
  });

  final String dayName;
  final List<WeeklyHour> windows;
  final VoidCallback onAdd;
  final ValueChanged<WeeklyHour> onRemove;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: AppSpacing.sm,
        ),
        decoration: BoxDecoration(
          color: scheme.surfaceContainerLow,
          borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
          border: Border.all(
            color: scheme.outlineVariant.withValues(alpha: 0.6),
          ),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 84,
              child: Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  dayName,
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
              ),
            ),
            Expanded(
              child:
                  windows.isEmpty
                      ? Padding(
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        child: Text(
                          'Closed',
                          style: TextStyle(color: scheme.onSurfaceVariant),
                        ),
                      )
                      : Wrap(
                        spacing: AppSpacing.sm,
                        runSpacing: 4,
                        children: [
                          for (final w in windows)
                            InputChip(
                              label: Text('${w.start} – ${w.end}'),
                              onDeleted: () => onRemove(w),
                              visualDensity: VisualDensity.compact,
                            ),
                        ],
                      ),
            ),
            IconButton(
              icon: Icon(
                Icons.add_circle_outline_rounded,
                color: AppColors.accentOn(context),
              ),
              tooltip: 'Add hours',
              onPressed: onAdd,
            ),
          ],
        ),
      ),
    );
  }
}

/// Marks where the practical details end and the brand begins.
class _BrandHeading extends StatelessWidget {
  const _BrandHeading();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Brand',
          style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 2),
        Text(
          'What patients see: on the prescription letterhead, in the chat '
          'header and on appointment confirmations.',
          style: TextStyle(
            fontSize: 12.5,
            height: 1.35,
            color: scheme.onSurfaceVariant,
          ),
        ),
      ],
    );
  }
}

/// The clinic's mark, on the ground it was drawn for.
class _LogoField extends StatelessWidget {
  const _LogoField({
    required this.url,
    required this.needsDarkChip,
    required this.busy,
    required this.onPick,
  });

  final String? url;
  final bool needsDarkChip;
  final bool busy;
  final VoidCallback onPick;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.6)),
      ),
      child: Row(
        children: [
          if (url != null)
            Container(
              width: 96,
              height: 56,
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                // The chip, when the artwork needs one. White otherwise,
                // because white is what the letterhead is.
                color: needsDarkChip ? const Color(0xFF10202E) : Colors.white,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(
                  color: scheme.outlineVariant.withValues(alpha: 0.6),
                ),
              ),
              child: AuthedImage(
                path: url!,
                width: double.infinity,
                height: double.infinity,
                radius: 0,
                fit: BoxFit.contain,
                background: Colors.transparent,
              ),
            )
          else
            Container(
              width: 96,
              height: 56,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: scheme.surfaceContainerHigh,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Icon(Icons.image_outlined, color: scheme.onSurfaceVariant),
            ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Clinic logo',
                  style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 2),
                Text(
                  url == null
                      ? 'A PNG with a transparent background works best.'
                      : needsDarkChip
                      ? 'Drawn for a dark background — shown on a dark panel so '
                          'the colours stay right.'
                      : 'Reads well on a light background.',
                  style: TextStyle(
                    fontSize: 12,
                    height: 1.3,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          busy
              ? const Padding(
                padding: EdgeInsets.symmetric(horizontal: 12),
                child: SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              )
              : TextButton(
                onPressed: onPick,
                child: Text(url == null ? 'Add' : 'Change'),
              ),
        ],
      ),
    );
  }
}
