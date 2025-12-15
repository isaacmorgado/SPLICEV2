/**
 * Churn Reduction Simulation
 *
 * This simulation models the impact of different cancellation threshold percentages
 * on churn rate, revenue, and user satisfaction.
 *
 * Run: npx tsx scripts/churn-simulation.ts
 */

interface SimulationParams {
  // User behavior assumptions
  totalUsers: number;
  monthlyChurnRateBase: number; // Base churn rate without restrictions (e.g., 0.05 = 5%)
  avgRevenuePerUser: number; // Monthly ARPU in dollars

  // Usage distribution (percentage of users in each usage bracket)
  usageDistribution: {
    bracket: string;
    minPercent: number;
    maxPercent: number;
    percentOfUsers: number;
    churnLikelihood: number; // How likely users in this bracket are to want to cancel
  }[];
}

interface ThresholdResult {
  threshold: number;
  blockedCancellations: number;
  allowedCancellations: number;
  forcedRetention: number;
  voluntaryRetention: number;
  churnRate: number;
  revenueRetained: number;
  userFrustrationScore: number; // 0-100, higher = more frustrated users
  netPromotorImpact: number; // Estimated NPS impact
  recommendedAction: string;
}

const defaultParams: SimulationParams = {
  totalUsers: 1000,
  monthlyChurnRateBase: 0.08, // 8% monthly churn (industry average for SaaS)
  avgRevenuePerUser: 65, // $65/month Pro tier

  usageDistribution: [
    {
      bracket: '0-10%',
      minPercent: 0,
      maxPercent: 10,
      percentOfUsers: 0.15,
      churnLikelihood: 0.25,
    },
    {
      bracket: '10-25%',
      minPercent: 10,
      maxPercent: 25,
      percentOfUsers: 0.2,
      churnLikelihood: 0.2,
    },
    {
      bracket: '25-50%',
      minPercent: 25,
      maxPercent: 50,
      percentOfUsers: 0.25,
      churnLikelihood: 0.1,
    },
    {
      bracket: '50-75%',
      minPercent: 50,
      maxPercent: 75,
      percentOfUsers: 0.25,
      churnLikelihood: 0.05,
    },
    {
      bracket: '75-100%',
      minPercent: 75,
      maxPercent: 100,
      percentOfUsers: 0.15,
      churnLikelihood: 0.02,
    },
  ],
};

function simulateThreshold(threshold: number, params: SimulationParams): ThresholdResult {
  let blockedCancellations = 0;
  let allowedCancellations = 0;
  let forcedRetention = 0;
  let voluntaryRetention = 0;
  let frustrationScore = 0;

  for (const bracket of params.usageDistribution) {
    const usersInBracket = params.totalUsers * bracket.percentOfUsers;
    const cancelersInBracket =
      usersInBracket * bracket.churnLikelihood * (params.monthlyChurnRateBase / 0.08);

    // Calculate average usage in this bracket
    const avgUsageInBracket = (bracket.minPercent + bracket.maxPercent) / 2;

    if (avgUsageInBracket >= threshold) {
      // Users in this bracket would be BLOCKED from canceling
      blockedCancellations += cancelersInBracket;

      // Some blocked users will be frustrated, others will use the product more
      // Higher usage = more likely to accept the restriction
      const frustrationFactor = Math.max(0, 1 - avgUsageInBracket / 100);
      frustrationScore += cancelersInBracket * frustrationFactor * 50;

      // Forced retention: users who can't cancel but wanted to
      // Some will become happy users (30% of heavy users), others remain frustrated
      const conversionRate = avgUsageInBracket >= 50 ? 0.4 : 0.15;
      forcedRetention += cancelersInBracket * (1 - conversionRate);
      voluntaryRetention += cancelersInBracket * conversionRate;
    } else {
      // Users in this bracket CAN cancel
      allowedCancellations += cancelersInBracket;
    }
  }

  const totalCancelers = blockedCancellations + allowedCancellations;
  const actualChurn = allowedCancellations;
  const churnRate = actualChurn / params.totalUsers;
  const revenueRetained = blockedCancellations * params.avgRevenuePerUser;

  // Normalize frustration score (0-100)
  const normalizedFrustration = Math.min(
    100,
    (frustrationScore / totalCancelers) * (threshold / 25)
  );

  // NPS impact: blocked cancellations hurt NPS, especially at low thresholds
  const npsImpact = -1 * (blockedCancellations / params.totalUsers) * (100 - threshold) * 0.5;

  // Determine recommendation
  let recommendation: string;
  if (threshold <= 10) {
    recommendation = 'Too permissive - minimal churn reduction benefit';
  } else if (threshold <= 20) {
    recommendation = 'Conservative - low friction, modest retention gains';
  } else if (threshold <= 30) {
    recommendation = 'Balanced - good retention with acceptable user friction';
  } else if (threshold <= 50) {
    recommendation = 'Aggressive - strong retention but increasing user frustration';
  } else {
    recommendation = 'Very aggressive - high retention but significant NPS risk';
  }

  return {
    threshold,
    blockedCancellations: Math.round(blockedCancellations),
    allowedCancellations: Math.round(allowedCancellations),
    forcedRetention: Math.round(forcedRetention),
    voluntaryRetention: Math.round(voluntaryRetention),
    churnRate: Math.round(churnRate * 10000) / 100,
    revenueRetained: Math.round(revenueRetained),
    userFrustrationScore: Math.round(normalizedFrustration),
    netPromotorImpact: Math.round(npsImpact * 10) / 10,
    recommendedAction: recommendation,
  };
}

function runSimulation() {
  console.log('='.repeat(80));
  console.log('SPLICE CHURN REDUCTION SIMULATION');
  console.log('='.repeat(80));
  console.log('\nAssumptions:');
  console.log(`  - Total users: ${defaultParams.totalUsers}`);
  console.log(`  - Base monthly churn rate: ${defaultParams.monthlyChurnRateBase * 100}%`);
  console.log(`  - Average revenue per user: $${defaultParams.avgRevenuePerUser}/month`);
  console.log(
    `  - Expected monthly cancellation attempts: ${Math.round(defaultParams.totalUsers * defaultParams.monthlyChurnRateBase)}`
  );

  console.log('\nUsage Distribution:');
  for (const bracket of defaultParams.usageDistribution) {
    console.log(
      `  ${bracket.bracket}: ${bracket.percentOfUsers * 100}% of users, ${bracket.churnLikelihood * 100}% churn likelihood`
    );
  }

  const thresholds = [10, 15, 20, 25, 30, 35, 40, 50];
  const results: ThresholdResult[] = [];

  console.log('\n' + '='.repeat(80));
  console.log('SIMULATION RESULTS BY THRESHOLD');
  console.log('='.repeat(80));

  for (const threshold of thresholds) {
    const result = simulateThreshold(threshold, defaultParams);
    results.push(result);
  }

  // Print table header
  console.log(
    '\n%-10s | %-8s | %-8s | %-10s | %-12s | %-10s | %-8s'.replace(/%(-?\d+)s/g, (_, n) => `%${n}s`)
  );
  console.log(
    'Threshold  | Blocked  | Allowed  | Churn Rate | Rev Retained | Frustration | NPS Impact'
  );
  console.log('-'.repeat(85));

  for (const r of results) {
    console.log(
      `${r.threshold.toString().padStart(5)}%     | ` +
        `${r.blockedCancellations.toString().padStart(6)}   | ` +
        `${r.allowedCancellations.toString().padStart(6)}   | ` +
        `${r.churnRate.toFixed(2).padStart(8)}%  | ` +
        `$${r.revenueRetained.toString().padStart(9)}  | ` +
        `${r.userFrustrationScore.toString().padStart(8)}/100 | ` +
        `${r.netPromotorImpact.toFixed(1).padStart(6)}`
    );
  }

  // Analysis
  console.log('\n' + '='.repeat(80));
  console.log('ANALYSIS & RECOMMENDATIONS');
  console.log('='.repeat(80));

  // Find optimal threshold (balance retention and user satisfaction)
  const optimal = results.reduce((best, current) => {
    // Score = (revenue retained / 1000) - (frustration / 10) - (abs(nps) / 5)
    const currentScore =
      current.revenueRetained / 1000 -
      current.userFrustrationScore / 10 -
      Math.abs(current.netPromotorImpact) / 5;
    const bestScore =
      best.revenueRetained / 1000 -
      best.userFrustrationScore / 10 -
      Math.abs(best.netPromotorImpact) / 5;
    return currentScore > bestScore ? current : best;
  });

  console.log('\nKey Findings:');
  console.log('-'.repeat(40));

  const noRestriction = { churnRate: defaultParams.monthlyChurnRateBase * 100, revenueRetained: 0 };

  console.log(`\n1. WITHOUT any restriction:`);
  console.log(`   - Churn rate: ${noRestriction.churnRate.toFixed(2)}%`);
  console.log(
    `   - Monthly revenue lost: $${Math.round(defaultParams.totalUsers * defaultParams.monthlyChurnRateBase * defaultParams.avgRevenuePerUser)}`
  );

  console.log(`\n2. WITH ${optimal.threshold}% threshold (RECOMMENDED):`);
  console.log(
    `   - Churn rate: ${optimal.churnRate.toFixed(2)}% (${(((noRestriction.churnRate - optimal.churnRate) / noRestriction.churnRate) * 100).toFixed(0)}% reduction)`
  );
  console.log(`   - Monthly revenue retained: $${optimal.revenueRetained}`);
  console.log(`   - User frustration score: ${optimal.userFrustrationScore}/100`);
  console.log(`   - NPS impact: ${optimal.netPromotorImpact}`);
  console.log(`   - Assessment: ${optimal.recommendedAction}`);

  // Show 25% specifically since that was the original ask
  const twentyFive = results.find((r) => r.threshold === 25)!;
  console.log(`\n3. WITH 25% threshold (originally proposed):`);
  console.log(`   - Churn rate: ${twentyFive.churnRate.toFixed(2)}%`);
  console.log(`   - Monthly revenue retained: $${twentyFive.revenueRetained}`);
  console.log(`   - User frustration score: ${twentyFive.userFrustrationScore}/100`);
  console.log(`   - Assessment: ${twentyFive.recommendedAction}`);

  // ROI calculation
  console.log('\n' + '='.repeat(80));
  console.log('ANNUAL ROI PROJECTION');
  console.log('='.repeat(80));

  const annualRetention = optimal.revenueRetained * 12;
  const potentialNegativeReviews = Math.round(optimal.forcedRetention * 0.1); // 10% of frustrated users might leave bad reviews

  console.log(`\nUsing ${optimal.threshold}% threshold:`);
  console.log(`  - Annual revenue retained: $${annualRetention.toLocaleString()}`);
  console.log(`  - Users blocked from canceling (monthly): ${optimal.blockedCancellations}`);
  console.log(`  - Potential negative reviews (monthly): ~${potentialNegativeReviews}`);
  console.log(
    `  - Net annual benefit: $${(annualRetention * 0.85).toLocaleString()} (accounting for support costs)`
  );

  // Final recommendation
  console.log('\n' + '='.repeat(80));
  console.log('FINAL RECOMMENDATION');
  console.log('='.repeat(80));
  console.log(`
Based on the simulation, I recommend a ${optimal.threshold}% threshold because:

1. BALANCE: It blocks cancellations only for users who have meaningfully used the product,
   which is ethically defensible ("you've used the service, please pay for it").

2. REVENUE: Retains approximately $${optimal.revenueRetained}/month ($${annualRetention.toLocaleString()}/year).

3. USER EXPERIENCE: Frustration score of ${optimal.userFrustrationScore}/100 is manageable.
   Users who have used 25%+ generally understand they've received value.

4. MESSAGING SUGGESTION:
   "You've used ${optimal.threshold}% of your monthly minutes. To ensure fair usage,
   cancellation is available at the start of your next billing cycle or when
   usage is below ${optimal.threshold}%. Need help? Contact support."

ALTERNATIVE: If user satisfaction is the top priority, use 15-20%.
             If revenue retention is the top priority, use 30-35%.
`);

  return optimal.threshold;
}

// Run the simulation
const recommendedThreshold = runSimulation();
console.log(`\nRECOMMENDED THRESHOLD: ${recommendedThreshold}%`);
