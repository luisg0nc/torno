import re

import pytest

from torno_kernel.loader import LoadError, choose_model, load_model, load_scene


def test_bracket_gives_assembly_and_print_layouts(ws):
    scene = load_scene(ws / "bracket", "bracket.py")
    assert list(scene) == ["assembly", "print"]
    assert set(scene["assembly"]) == {"base", "post"}
    assert set(scene["print"]) == {"base", "post"}


def test_bracket_layouts_hold_the_shapes_the_model_returned(ws):
    scene = load_scene(ws / "bracket", "bracket.py")
    assert scene["assembly"]["base"].volume == pytest.approx(40 * 30 * 5)
    assert scene["assembly"]["post"].center().Z == pytest.approx(12.5)
    assert scene["print"]["post"].center().X == pytest.approx(60)


def test_model_is_imported_not_run_as_main(ws):
    # bracket.py raises SystemExit under `if __name__ == "__main__"`.
    load_scene(ws / "bracket", "bracket.py")


def test_plain_gives_main_layout_with_public_shapes_only(ws):
    scene = load_scene(ws / "plain", "plain.py")
    assert list(scene) == ["main"]
    assert list(scene["main"]) == ["plate"]


def test_chatty_loads_despite_printing(ws, capsys):
    scene = load_scene(ws / "chatty", "chatty.py")
    assert list(scene) == ["assembly"]
    assert list(scene["assembly"]) == ["plate"]
    assert capsys.readouterr().out == "report line\nreport line\n"


def test_broken_raises_exception_with_message_and_trimmed_traceback(ws):
    with pytest.raises(LoadError) as info:
        load_scene(ws / "broken", "broken.py")
    err = info.value
    assert err.kind == "exception"
    assert "wall too thin" in err.message
    assert "broken.py" in err.traceback
    assert "ValueError" in err.traceback
    assert "loader.py" not in err.traceback


def test_noscene_raises_no_scene_naming_what_was_looked_for(ws):
    with pytest.raises(LoadError) as info:
        load_scene(ws / "noscene", "noscene.py")
    assert info.value.kind == "no_scene"
    assert info.value.message == (
        "noscene.py defines no assembly(p), printables(p), make_<part>(p) or top-level shapes"
    )
    assert info.value.traceback == ""


def model(tmp_path, source: str) -> str:
    (tmp_path / "part.py").write_text(source)
    return "part.py"


def test_no_scene_says_that_params_is_missing_when_the_functions_are_there(tmp_path):
    source = "def assembly(p):\n    return {}\n\ndef printables(p):\n    return {}\n"
    with pytest.raises(LoadError) as info:
        load_scene(tmp_path, model(tmp_path, source))
    assert info.value.kind == "no_scene"
    assert info.value.message == (
        "part.py defines assembly(p) and printables(p) but no Params class to call them with, "
        "and no top-level shapes"
    )


def test_no_scene_names_a_lone_maker_without_params(tmp_path):
    with pytest.raises(LoadError) as info:
        load_scene(tmp_path, model(tmp_path, "def make_lid(p):\n    return None\n"))
    assert info.value.message == (
        "part.py defines make_lid(p) but no Params class to call it with, and no top-level shapes"
    )


def test_makers_give_a_main_layout_named_after_the_functions(ws):
    scene = load_scene(ws / "makers", "makers.py")
    assert list(scene) == ["main"]
    # In the order the model defines them; what is not a part is left out.
    assert list(scene["main"]) == ["stand", "speaker"]
    assert scene["main"]["stand"].volume == pytest.approx(60 * 40 * 10)
    assert scene["main"]["speaker"].center().Z == pytest.approx(25)


PARAMS = "from dataclasses import dataclass\nfrom build123d import Box\n\n@dataclass\nclass Params:\n    w: float = 5\n\n"


def test_assembly_and_printables_come_before_makers(tmp_path):
    source = PARAMS + (
        "def assembly(p):\n    return {'a': Box(p.w, 1, 1)}\n\n"
        "def make_b(p):\n    return Box(1, 1, 1)\n"
    )
    scene = load_scene(tmp_path, model(tmp_path, source))
    assert list(scene) == ["assembly"]


def test_makers_come_before_top_level_shapes(tmp_path):
    source = PARAMS + "blank = Box(9, 9, 9)\n\ndef make_b(p):\n    return Box(p.w, 1, 1)\n"
    scene = load_scene(tmp_path, model(tmp_path, source))
    assert list(scene["main"]) == ["b"]


def test_makers_that_yield_no_part_fall_back_to_top_level_shapes(tmp_path):
    source = PARAMS + "blank = Box(9, 9, 9)\n\ndef make_note(p):\n    return 'text'\n"
    scene = load_scene(tmp_path, model(tmp_path, source))
    assert list(scene["main"]) == ["blank"]


def test_a_maker_that_raises_is_an_exception_with_the_model_traceback(tmp_path):
    source = PARAMS + "def make_b(p):\n    raise ValueError('slot too wide')\n"
    with pytest.raises(LoadError) as info:
        load_scene(tmp_path, model(tmp_path, source))
    assert info.value.kind == "exception"
    assert "slot too wide" in info.value.message
    assert "make_b" in info.value.traceback
    assert "loader.py" not in info.value.traceback


def test_a_maker_needs_exactly_one_required_parameter(tmp_path):
    source = PARAMS + (
        "def make_none():\n    return Box(1, 1, 1)\n\n"
        "def make_two(p, q):\n    return Box(1, 1, 1)\n\n"
        "def make_keyword(*, p):\n    return Box(1, 1, 1)\n\n"
        "def make_default(p, scale=2):\n    return Box(p.w, scale, 1)\n\n"
        "def make_rest(p, *more, **named):\n    return Box(p.w, 1, 1)\n\n"
        "def _make_private(p):\n    return Box(1, 1, 1)\n\n"
        "def make_(p):\n    return Box(1, 1, 1)\n\n"
        "make_value = Box(2, 2, 2).volume\n\n"
        "class make_class:\n    def __init__(self, p):\n        pass\n"
    )
    scene = load_scene(tmp_path, model(tmp_path, source))
    assert list(scene["main"]) == ["default", "rest"]


def test_makers_imported_from_elsewhere_are_not_parts(tmp_path):
    (tmp_path / "helpers.py").write_text("from build123d import Box\n\ndef make_jig(p):\n    return Box(3, 3, 3)\n")
    source = PARAMS + "from helpers import make_jig\n\ndef make_b(p):\n    return Box(p.w, 1, 1)\n"
    scene = load_scene(tmp_path, model(tmp_path, source))
    assert list(scene["main"]) == ["b"]


def test_choose_model_picks_the_model_and_ignores_tests(ws):
    assert choose_model(ws / "bracket") == ws / "bracket" / "bracket.py"


def test_choose_model_ignores_suffix_tests_and_conftest(tmp_path):
    for name in ("part.py", "part_test.py", "test_part.py", "conftest.py"):
        (tmp_path / name).write_text("")
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "other.py").write_text("")
    assert choose_model(tmp_path) == tmp_path / "part.py"


def test_empty_folder_raises_no_model(ws):
    with pytest.raises(LoadError) as info:
        choose_model(ws / "empty")
    assert info.value.kind == "no_model"
    assert info.value.message == f"no model file in {ws / 'empty'}"


def test_two_candidates_raise_no_model_naming_them(ws):
    with pytest.raises(LoadError) as info:
        choose_model(ws / "two")
    assert info.value.kind == "no_model"
    assert "a.py" in info.value.message
    assert "b.py" in info.value.message


def test_choose_model_prefers_the_file_named_after_the_folder(tmp_path):
    folder = tmp_path / "helmet-stand"
    folder.mkdir()
    for name in ("helmet_stand.py", "scratch.py", "measure.py"):
        (folder / name).write_text("")
    assert choose_model(folder) == folder / "helmet_stand.py"

    other = tmp_path / "speaker_stand"
    other.mkdir()
    for name in ("speaker-stand.py", "notes.py"):
        (other / name).write_text("")
    assert choose_model(other) == other / "speaker-stand.py"


def test_choose_model_is_ambiguous_when_two_files_are_named_after_the_folder(tmp_path):
    folder = tmp_path / "two-names"
    folder.mkdir()
    for name in ("two-names.py", "two_names.py", "other.py"):
        (folder / name).write_text("")
    with pytest.raises(LoadError) as info:
        choose_model(folder)
    assert info.value.message == (
        f"more than one model file in {folder}: other.py, two-names.py, two_names.py"
    )


def test_choose_model_ignores_init_and_dotfiles(tmp_path):
    for name in ("__init__.py", ".draft.py", "part.py"):
        (tmp_path / name).write_text("")
    assert choose_model(tmp_path) == tmp_path / "part.py"
    (tmp_path / "part.py").unlink()
    with pytest.raises(LoadError) as info:
        choose_model(tmp_path)
    assert info.value.message == f"no model file in {tmp_path}"


def test_groups_are_read_in_model_order(ws):
    _, _, groups = load_model(ws / "grouped", "grouped.py")
    assert groups == [{"name": "flat", "parts": ["flat-a", "flat-b"]}, {"name": "tall", "parts": ["tall-a"]}]


def test_no_groups_function_gives_none(ws):
    assert load_model(ws / "bracket", "bracket.py")[2] == []


@pytest.mark.parametrize(
    "body, said",
    [
        ('{"flat": ["nope"]}', "groups() names nope, which no layout has"),
        ('{"flat/x": ["flat-a"]}', "a group name has no /"),
        ('{"M3": ["flat-a"]}', "group M3 has the form of a mark's id"),
        ('{"": ["flat-a"]}', "a group name is not empty"),
        ('{"key": ["flat-a"]}', "group key has the name of a part"),
        ('{"a": ["flat-a"], "b": ["flat-a"]}', "flat-a is in groups a and b"),
        ('{"a": []}', "group a has no parts"),
        ('{"a": "flat-a"}', "groups() must return a dict of group name to part names"),
        ('["flat-a"]', "groups() must return a dict of group name to part names"),
        ('1 / 0', "division by zero"),
    ],
)
def test_bad_groups_fail_the_build(ws, tmp_path, body, said):
    src = (ws / "grouped" / "grouped.py").read_text().replace(
        'return {"flat": ["flat-a", "flat-b"], "tall": ["tall-a"]}', f"return {body}"
    )
    (tmp_path / "g.py").write_text(src)
    with pytest.raises(LoadError, match=re.escape(said)) as e:
        load_model(tmp_path, "g.py")
    assert e.value.kind == "exception"
