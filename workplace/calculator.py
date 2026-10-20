"""一个简单的示例模块，用于演示单元测试。"""


def add(a, b):
    return a + b


def sub(a, b):
    return a - b


def mul(a, b):
    return a * b


def div(a, b):
    if b == 0:
        raise ValueError("除数不能为 0")
    return a / b


def is_even(n):
    return n % 2 == 0


if __name__ == "__main__":
    print("1 + 2 =", add(1, 2))
    print("10 / 4 =", div(10, 4))
