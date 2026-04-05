from __future__ import annotations

import datetime as dt
import json
import zipfile
from pathlib import Path

import pandas as pd
from sklearn.linear_model import LogisticRegression

BETTING_PLATFORMS = ['B365', 'BW', 'IW', 'PS', 'WH', 'VC']
COUNTRIES = ["England", "Spain", "Italy", "Germany", "France"]


def ensure_source_available():
    zip_path = Path("SportsBet-main.zip")
    folder = Path("SportsBet-main")
    if folder.exists():
        return
    if zip_path.exists():
        with zipfile.ZipFile(zip_path, "r") as z:
            z.extractall(".")
        return
    raise FileNotFoundError(
        "Lipsește sursa SportsBet. Pune în repo fie folderul 'SportsBet-main', fie fișierul 'SportsBet-main.zip'."
    )


def get_current_season_id(today: dt.date | None = None) -> str:
    today = today or dt.date.today()
    if today.month >= 7:
        start = today.year % 100
        end = (today.year + 1) % 100
    else:
        start = (today.year - 1) % 100
        end = today.year % 100
    return f"{start:02d}{end:02d}"


def training_end_year_from_current_season(current_season_id: str) -> str:
    return current_season_id[:2]


def league_code(country: str, division: int = 1) -> str:
    id_country = country[0].upper()
    if country.lower() == "spain":
        id_country = "SP"
    elif country.lower() == "germany":
        id_country = "D"
    elif country.lower() == "england":
        division -= 1
    return f"{id_country}{division}"


def build_kwargs(country: str, training_end_year: str) -> dict:
    return {
        "country": country,
        "division": 1,
        "start_season": "10",
        "end_season": training_end_year,
        "betting_platform": "B365",
        "initial_bankroll": 100,
        "stake_per_bet": 1,
        "do_value_betting": False,
        "value_betting_on_all_results": False,
        "analyze_betting_platforms_margins": False,
        "match_history_length": 3,
        "number_previous_direct_confrontations": 3,
        "match_results_encoding": "points",
        "model_name": "LogisticRegression",
        "config_name": "SportsBet-main/configs/LogisticRegression.json",
    }


def format_kickoff(value) -> str:
    try:
        return pd.to_datetime(value).strftime("%Y-%m-%d")
    except Exception:
        return str(value)


def tag_from_confidence(confidence: int) -> str:
    if confidence >= 85:
        return "safe"
    if confidence >= 75:
        return "value"
    return "risk"


def average_available(match_row: pd.Series, candidates: list[str]) -> float:
    available = [col for col in candidates if col in match_row.index and pd.notna(match_row[col])]
    if not available:
        return 0.0
    return round(float(pd.Series(match_row[available]).astype(float).mean()), 2)


def odds_1x2(match_row: pd.Series, predicted_result: str) -> float:
    suffix = {"H": "H", "D": "D", "A": "A"}[predicted_result]
    return average_available(
        match_row,
        [f"{platform}{suffix}" for platform in BETTING_PLATFORMS] + [f"Avg{suffix}", f"Max{suffix}"]
    )


def odds_over25(match_row: pd.Series) -> float:
    return average_available(match_row, ["B365>2.5", "P>2.5", "Avg>2.5", "Max>2.5"])


def odds_under35(match_row: pd.Series) -> float:
    return average_available(match_row, ["B365<3.5", "P<3.5", "Avg<3.5", "Max<3.5"])


def odds_btts(match_row: pd.Series, yes_pick: bool) -> float:
    if yes_pick:
        return average_available(match_row, ["B365BTSY", "BTSY", "AvgBTSY", "MaxBTSY"])
    return average_available(match_row, ["B365BTSN", "BTSN", "AvgBTSN", "MaxBTSN"])


def value_flag(probability: float, odds: float) -> bool:
    if odds <= 0:
        return False
    return (probability * odds) > 1.0


def build_reason(market: str, confidence: int, country: str) -> str:
    return f"Predicție {market} generată din modelul SportsBet pentru {country}. Încredere estimată: {confidence}%."


def train_logreg_with_preprocessing(training_features: pd.DataFrame, labels: pd.Series):
    from predictions import dataset_preprocessing
    tmp = training_features.copy()
    tmp["result"] = labels
    X, Y, label_encoder, feature_preprocessor = dataset_preprocessing(tmp)
    model = LogisticRegression(C=1e5, max_iter=1000)
    model.fit(X, Y)
    return model, label_encoder, feature_preprocessor


def predict_with_model(model, label_encoder, feature_preprocessor, pending_features: pd.DataFrame) -> pd.DataFrame:
    X_pending = feature_preprocessor.transform(pending_features.drop(columns=["result"]))
    proba = model.predict_proba(X_pending)
    return pd.DataFrame(proba, columns=label_encoder.classes_, index=pending_features.index)


def build_training_frames(league) -> tuple[pd.DataFrame, pd.DataFrame]:
    feature_frames = []
    meta_frames = []
    for season in league.seasons:
        ds = season.dataset.copy()
        meta = season.matches.loc[ds.index].copy()
        feature_frames.append(ds)
        meta_frames.append(meta)
    features = pd.concat(feature_frames)
    meta = pd.concat(meta_frames).loc[features.index]
    return features, meta


def build_pending_features(country: str, current_season: str, kwargs: dict):
    from game import Season

    season = Season(
        league_code(country, 1),
        current_season,
        [],
        BETTING_PLATFORMS,
        **kwargs
    )
    season.clear_data()

    pending_examples = []
    pending_matches = []

    dates = sorted(pd.to_datetime(season.matches["Date"]).unique())
    for current_date in dates:
        day_matches = season.matches.loc[season.matches["Date"] == current_date]

        for idx, match in day_matches.iterrows():
            result = match.get("FTR")
            if result not in ["H", "D", "A"]:
                example = season.prepare_example(match)
                pending_examples.append((idx, example))
                pending_matches.append((idx, match))

        played = day_matches.loc[day_matches["FTR"].isin(["H", "D", "A"])]
        if len(played):
            season.update_statistics(played)

    if not pending_examples:
        return pd.DataFrame(), {}

    pending_df = pd.DataFrame(
        [example for _, example in pending_examples],
        index=[idx for idx, _ in pending_examples]
    )
    pending_df = pending_df.dropna()

    match_lookup = {idx: match for idx, match in pending_matches if idx in pending_df.index}
    return pending_df, match_lookup


def append_prediction(
    predictions: list,
    league_name: str,
    match_name: str,
    kickoff: str,
    market: str,
    pick: str,
    confidence: int,
    odds: float,
    value: bool,
    reason: str
):
    predictions.append({
        "league": league_name,
        "match": match_name,
        "kickoff": kickoff,
        "market": market,
        "pick": pick,
        "confidence": confidence,
        "odds": odds,
        "tag": tag_from_confidence(confidence),
        "value": value,
        "reason": reason
    })


def main():
    ensure_source_available()
    import sys
    sys.path.insert(0, str(Path("SportsBet-main").resolve()))

    from game import League

    current_season = get_current_season_id()
    training_end_year = training_end_year_from_current_season(current_season)
    all_predictions = []

    for country in COUNTRIES:
        kwargs = build_kwargs(country, training_end_year)

        league = League(BETTING_PLATFORMS, **kwargs)
        league.run()

        training_features, training_meta = build_training_frames(league)

        result_model, result_le, result_pre = train_logreg_with_preprocessing(
            training_features.drop(columns=["result"]).copy(),
            training_features["result"].copy()
        )

        total_goals = training_meta["FTHG"].fillna(0).astype(float) + training_meta["FTAG"].fillna(0).astype(float)
        over15_labels = (total_goals >= 2).astype(int)
        over25_labels = (total_goals >= 3).astype(int)
        under35_labels = (total_goals <= 3).astype(int)
        btts_labels = (
            (training_meta["FTHG"].fillna(0).astype(float) > 0)
            & (training_meta["FTAG"].fillna(0).astype(float) > 0)
        ).astype(int)

        base_features = training_features.drop(columns=["result"]).copy()

        over15_model, over15_le, over15_pre = train_logreg_with_preprocessing(base_features, over15_labels)
        over25_model, over25_le, over25_pre = train_logreg_with_preprocessing(base_features, over25_labels)
        under35_model, under35_le, under35_pre = train_logreg_with_preprocessing(base_features, under35_labels)
        btts_model, btts_le, btts_pre = train_logreg_with_preprocessing(base_features, btts_labels)

        pending_df, match_lookup = build_pending_features(country, current_season, kwargs)
        if pending_df.empty:
            continue

        result_proba = predict_with_model(result_model, result_le, result_pre, pending_df)
        over15_proba = predict_with_model(over15_model, over15_le, over15_pre, pending_df)
        over25_proba = predict_with_model(over25_model, over25_le, over25_pre, pending_df)
        under35_proba = predict_with_model(under35_model, under35_le, under35_pre, pending_df)
        btts_proba = predict_with_model(btts_model, btts_le, btts_pre, pending_df)

        for idx in pending_df.index:
            match_row = match_lookup[idx]
            home = str(match_row.get("HomeTeam", "Home"))
            away = str(match_row.get("AwayTeam", "Away"))
            match_name = f"{home} vs {away}"
            kickoff = format_kickoff(match_row.get("Date", "-"))
            league_name = f"{country} - Division 1"

            r = result_proba.loc[idx]
            pred_result = str(r.idxmax())
            result_probability = float(r[pred_result])
            result_conf = int(round(result_probability * 100))
            result_odds = odds_1x2(match_row, pred_result)

            if pred_result == "H":
                result_pick = f"{home} câștigă"
            elif pred_result == "A":
                result_pick = f"{away} câștigă"
            else:
                result_pick = "Egal"

            append_prediction(
                all_predictions,
                league_name,
                match_name,
                kickoff,
                "1X2",
                result_pick,
                result_conf,
                result_odds,
                value_flag(result_probability, result_odds),
                build_reason("1X2", result_conf, country)
            )

            dc_options = {
                "1X": float(r.get("H", 0.0) + r.get("D", 0.0)),
                "X2": float(r.get("D", 0.0) + r.get("A", 0.0)),
                "12": float(r.get("H", 0.0) + r.get("A", 0.0)),
            }
            dc_pick = max(dc_options, key=dc_options.get)
            dc_prob = dc_options[dc_pick]
            dc_conf = int(round(dc_prob * 100))

            append_prediction(
                all_predictions,
                league_name,
                match_name,
                kickoff,
                "Double Chance",
                dc_pick,
                dc_conf,
                0.0,
                False,
                build_reason("Double Chance", dc_conf, country)
            )

            over15_yes_prob = float(over15_proba.loc[idx].get(1, 0.0))
            over15_conf = int(round(over15_yes_prob * 100))
            append_prediction(
                all_predictions,
                league_name,
                match_name,
                kickoff,
                "Over 1.5",
                "Peste 1.5 goluri",
                over15_conf,
                0.0,
                False,
                build_reason("Over 1.5", over15_conf, country)
            )

            over25_yes_prob = float(over25_proba.loc[idx].get(1, 0.0))
            over25_conf = int(round(over25_yes_prob * 100))
            over25_odds_value = odds_over25(match_row)
            append_prediction(
                all_predictions,
                league_name,
                match_name,
                kickoff,
                "Over 2.5",
                "Peste 2.5 goluri",
                over25_conf,
                over25_odds_value,
                value_flag(over25_yes_prob, over25_odds_value),
                build_reason("Over 2.5", over25_conf, country)
            )

            under35_yes_prob = float(under35_proba.loc[idx].get(1, 0.0))
            under35_conf = int(round(under35_yes_prob * 100))
            under35_odds_value = odds_under35(match_row)
            append_prediction(
                all_predictions,
                league_name,
                match_name,
                kickoff,
                "Under 3.5",
                "Sub 3.5 goluri",
                under35_conf,
                under35_odds_value,
                value_flag(under35_yes_prob, under35_odds_value),
                build_reason("Under 3.5", under35_conf, country)
            )

            btts_yes_prob = float(btts_proba.loc[idx].get(1, 0.0))
            btts_no_prob = 1.0 - btts_yes_prob
            btts_pick_yes = btts_yes_prob >= btts_no_prob
            btts_prob = btts_yes_prob if btts_pick_yes else btts_no_prob
            btts_conf = int(round(btts_prob * 100))
            btts_pick = "Ambele marchează" if btts_pick_yes else "Ambele NU marchează"
            btts_odds_value = odds_btts(match_row, btts_pick_yes)

            append_prediction(
                all_predictions,
                league_name,
                match_name,
                kickoff,
                "BTTS",
                btts_pick,
                btts_conf,
                btts_odds_value,
                value_flag(btts_prob, btts_odds_value),
                build_reason("BTTS", btts_conf, country)
            )

    all_predictions.sort(key=lambda item: (item["confidence"], item["odds"]), reverse=True)

    output = {"predictions": all_predictions}
    Path("data.json").write_text(
        json.dumps(output, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    print(f"Scrise {len(all_predictions)} predicții în data.json")


if __name__ == "__main__":
    main()
