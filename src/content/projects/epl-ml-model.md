---
title: "EPL ML Model"
subtitle: "Predicting football match outcomes with machine learning"
order: 5
gistUrl: "https://gist.github.com/DylanMcCavitt/c3ead5e9ee4867308e326eb1799478e7"
---

![Model accuracy comparison](/screenshots/epl-ml-model/accuracy-comparison.png)

## What it is

A group project that predicts English Premier League match outcomes using 20+ years of match data. We trained and compared eight different models (Random Forest, MLP neural network, Decision Tree, KNN, Naive Bayes, Logistic Regression, XGBoost, and SVM) to see which best predicts whether the home team wins.

The dataset has 39 features including goals scored, win/loss streaks, goal differentials, and form points. We handled missing data, capped outliers, engineered features, and ran each model through the same train-test split for a fair comparison.

## Results

XGBoost came out on top at ~99% accuracy, with SVM and Logistic Regression right behind it. The simpler models like KNN and Naive Bayes sat around 80%, struggling with the interdependent features. The gap showed that model choice matters less than feature quality, but the right algorithm still makes a real difference.

## What I learned

The most useful part of this project wasn't the modeling, it was the data work. Cleaning, imputing missing values, engineering streak and differential features, and scaling correctly had a bigger impact on results than swapping algorithms. Also learned that simple models like Logistic Regression can hang with XGBoost when the features are good, which is worth knowing when interpretability matters.

<div class="screenshot-strip">

![Correlation heatmap](/screenshots/epl-ml-model/correlation-heatmap.png)

![Decision tree visualization](/screenshots/epl-ml-model/decision-tree.png)

![XGBoost results](/screenshots/epl-ml-model/xgboost.png)

</div>

[View the full notebook →](https://gist.github.com/DylanMcCavitt/c3ead5e9ee4867308e326eb1799478e7)
