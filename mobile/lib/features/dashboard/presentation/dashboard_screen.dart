import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/empty_view.dart';
import '../../../shared/widgets/error_view.dart';
import '../../../shared/widgets/loading_view.dart';
import '../../auth/presentation/auth_controller.dart';
import '../data/dashboard_repository.dart';
import '../domain/dashboard_data.dart';
import 'widgets/adherence_tile.dart';
import 'widgets/alerts_banner.dart';
import 'widgets/glucose_summary_card.dart';
import 'widgets/health_score_card.dart';
import 'widgets/appointments_section.dart';
import 'widgets/recommendations_list.dart';

class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final dashboardAsync = ref.watch(dashboardProvider);
    final user = ref.watch(authControllerProvider).user;

    return Scaffold(
      appBar: AppBar(
        title: Text(_greeting(l10n, user?.name)),
        automaticallyImplyLeading: false,
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(dashboardProvider);
          await ref.read(dashboardProvider.future);
        },
        child: dashboardAsync.when(
          loading: () => const LoadingView(),
          error:
              (error, _) => ListView(
                children: [
                  SizedBox(
                    height: MediaQuery.of(context).size.height * 0.7,
                    child: ErrorView(
                      error: error,
                      title: l10n.dashboardErrorTitle,
                      onRetry: () => ref.invalidate(dashboardProvider),
                    ),
                  ),
                ],
              ),
          data: (data) => _DashboardContent(data: data),
        ),
      ),
    );
  }

  String _greeting(AppLocalizations l10n, String? name) {
    final hour = DateTime.now().hour;
    final firstName =
        (name == null || name.trim().isEmpty)
            ? ''
            : name.trim().split(' ').first;
    if (hour < 12) return l10n.dashboardGreetingMorning(firstName);
    if (hour < 17) return l10n.dashboardGreetingAfternoon(firstName);
    return l10n.dashboardGreetingEvening(firstName);
  }
}

class _DashboardContent extends StatelessWidget {
  const _DashboardContent({required this.data});

  final DashboardData data;

  bool get _isEmpty =>
      !data.healthScore.components.values.any((c) => c.hasData) &&
      data.glucose.latest == null &&
      data.openAlerts.isEmpty;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    if (_isEmpty) {
      return ListView(
        children: [
          SizedBox(
            height: MediaQuery.of(context).size.height * 0.7,
            child: EmptyView(
              icon: Icons.dashboard_customize_outlined,
              title: l10n.dashboardEmptyTitle,
              body: l10n.dashboardEmptyBody,
              action: FilledButton(
                onPressed: () => context.go('/track'),
                child: Text(l10n.glucoseLogReading),
              ),
            ),
          ),
        ],
      );
    }

    final reminderChips = <Widget>[
      if (data.reminders.footScreeningDue)
        _ReminderChip(
          label: l10n.dashboardFootScreeningDue,
          onTap: () => context.go('/care/foot'),
        ),
      if (data.reminders.eyeScreeningDue)
        _ReminderChip(
          label: l10n.dashboardEyeScreeningDue,
          onTap: () => context.go('/care/eye'),
        ),
      if (data.reminders.hba1cDue)
        _ReminderChip(
          label: l10n.dashboardHba1cDue,
          onTap: () => context.go('/care/labs'),
        ),
    ];

    return ListView(
      padding: const EdgeInsets.all(AppSpacing.md),
      children: [
        const _QuickActions(),
        const SizedBox(height: AppSpacing.lg),
        HealthScoreCard(healthScore: data.healthScore),
        const SizedBox(height: AppSpacing.md),
        GlucoseSummaryCard(glucose: data.glucose),
        const SizedBox(height: AppSpacing.md),
        AdherenceTile(adherence: data.adherence),
        const SizedBox(height: AppSpacing.md),
        const AppointmentsSection(),
        if (reminderChips.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.md),
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            children: reminderChips,
          ),
        ],
        if (data.openAlerts.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.lg),
          AlertsBanner(alerts: data.openAlerts),
        ],
        const SizedBox(height: AppSpacing.lg),
        RecommendationsList(recommendations: data.recommendations),
        const SizedBox(height: AppSpacing.xxl),
      ],
    );
  }
}

/// Fast shortcuts to the three things a patient does most from home: log a
/// reading, book a visit, and ask the assistant.
class _QuickActions extends StatelessWidget {
  const _QuickActions();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Row(
      children: [
        Expanded(
          child: _QuickAction(
            icon: Icons.add_chart_rounded,
            color: AppColors.accentOn(context),
            label: l10n.glucoseLogReading,
            onTap: () => context.go('/track'),
          ),
        ),
        const SizedBox(width: AppSpacing.sm),
        Expanded(
          child: _QuickAction(
            icon: Icons.event_available_rounded,
            color: AppColors.successOn(context),
            label: l10n.apptBook,
            onTap: () => context.go('/care/appointments/book'),
          ),
        ),
        const SizedBox(width: AppSpacing.sm),
        Expanded(
          child: _QuickAction(
            icon: Icons.auto_awesome_rounded,
            color: const Color(0xFF7C3AED),
            label: l10n.chatTitle,
            onTap: () => context.go('/chat'),
          ),
        ),
      ],
    );
  }
}

class _QuickAction extends StatelessWidget {
  const _QuickAction({
    required this.icon,
    required this.color,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final Color color;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
      child: Container(
        padding: const EdgeInsets.symmetric(
          vertical: AppSpacing.md,
          horizontal: AppSpacing.sm,
        ),
        decoration: BoxDecoration(
          color: scheme.surfaceContainerLow,
          borderRadius: BorderRadius.circular(AppSpacing.cardRadius),
          border: Border.all(
            color: scheme.outlineVariant.withValues(alpha: 0.6),
          ),
        ),
        child: Column(
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.14),
                shape: BoxShape.circle,
              ),
              child: Icon(icon, color: color, size: 22),
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              label,
              textAlign: TextAlign.center,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                height: 1.2,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ReminderChip extends StatelessWidget {
  const _ReminderChip({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ActionChip(
      avatar: Icon(
        Icons.notifications_active_outlined,
        size: 18,
        color: AppColors.warningOn(context),
      ),
      label: Text(label),
      backgroundColor: AppColors.warningBgOn(context),
      onPressed: onTap,
    );
  }
}
